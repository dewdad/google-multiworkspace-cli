#!/usr/bin/env python3
"""Capture the Google OAuth URL that `gwcli profiles auth <name>` prints, and
hold the process open until the localhost callback completes.

STATUS (current gwcli): this script is now an OPTIONAL convenience, not a
requirement. `gwcli profiles auth` resolves the profile's stored scopes and
passes them to gws as `--services`, which skips gws's interactive scope
picker entirely — so the carriage-return "Confirm the picker" logic below is
a no-op for any scoped profile (it only ever fires if gws is somehow launched
with no services on a live TTY). gwcli also auto-launches the OS default
browser on the detected URL; in an agent/headless context that OS tab is a
dead window — ignore it and route the captured URL into your shared browser.
A plain `gwcli profiles auth <name>` with stdout capture achieves the same
hand-off; use this wrapper only for the tagged `[driver] URL_CAPTURED ` line
and the fixed 10-minute deadline.

Designed to be invoked by an agent: gets you to the URL handoff stage with
zero human keystrokes on the terminal side, so the human only has to click in
the browser.

Usage:
    drive_gwcli_auth.py <profile_name>

Behavior:
    1. Spawns gwcli in a fresh PTY with a sane window size (Ink/ratatui won't
       render the picker without one — that's why a naive `gwcli profiles auth`
       inside a non-TTY agent shell hangs silently).
    2. Waits for the scope-picker prompt by detecting "Confirm" + "Cancel"
       in the ANSI-stripped output (the raw bytes have escape codes splitting
       the words, so a naive substring search misses them).
    3. After a brief settle, sends ONE carriage return ('\\r'). Ink TUIs treat
       '\\r' as Confirm; '\\n' is Down-Arrow because of cooked-mode line
       discipline — using '\\n' will navigate the picker, NOT confirm.
    4. Captures the next 'https://accounts.google.com/o/oauth2/auth?...' URL
       and prints it on a line beginning '[driver] URL_CAPTURED '. Caller
       greps for that prefix.
    5. KEEPS RUNNING after URL capture so the gws callback server stays
       alive. Exits only when:
         - 'Authentication successful' is seen (success path), or
         - the child process is reaped (death path), or
         - the 120s deadline elapses (timeout path).

Pitfalls discovered the hard way:
  - Without `os.environ['COLUMNS']/['LINES']` set on the child + a TIOCSWINSZ
    on the master, Ink stays mute — gws prints nothing and the picker never
    appears. The pty looks alive but no scope choices ever render.
  - The picker text 'Enter Confirm' is rendered as
    `\\x1b[38;5;2;49m Enter \\x1b[39;49mConfirm` — the words are split by
    color escapes. Search the ANSI-STRIPPED buffer, not the raw bytes.
  - The match-then-evaluate logic must run on EVERY tick of the select loop,
    not only when select() returned data. Otherwise a "wait 0.8s then send CR"
    timer never fires after the TUI goes idle (no new bytes → no re-eval).
  - When the gwcli node wrapper exits after launching gws, it can close its
    stdout pipe and the PTY master sees EOF — but the gws subprocess is still
    listening for the OAuth callback on its own port. Don't bail on first
    empty read; check whether the child is actually reaped (`waitpid WNOHANG`)
    and otherwise keep looping. Bailing on EOF was the bug that caused the
    second profile in our session to exit cleanly without writing creds.

Install:
    cp <skill-dir>/scripts/drive_gwcli_auth.py ~/.local/bin/
    chmod +x ~/.local/bin/drive_gwcli_auth.py
"""
import os, pty, sys, select, re, time, fcntl, termios, struct

if len(sys.argv) != 2:
    print("usage: drive_gwcli_auth.py <profile_name>", file=sys.stderr)
    sys.exit(2)

profile = sys.argv[1]
pid, master_fd = pty.fork()
if pid == 0:
    # child: ensure TERM is sane and Ink/ratatui can render
    os.environ.setdefault("TERM", "xterm-256color")
    os.environ.setdefault("COLUMNS", "200")
    os.environ.setdefault("LINES", "50")
    os.execvp("gwcli", ["gwcli", "profiles", "auth", profile])

# parent: set window size on the pty so Ink renders the picker
try:
    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 200, 0, 0))
except Exception as e:
    print(f"[driver] WARN: could not set winsize: {e}", file=sys.stderr)

buf = b""
url = None
url_re = re.compile(rb"https://accounts\.google\.com/o/oauth2/auth\?[^\s\x1b]+")
ansi_re = re.compile(rb"\x1b\[[0-9;?]*[a-zA-Z]")
sent_confirm = False
confirm_at = None
url_emitted = False
deadline = time.time() + 600  # 10 min — enough for password+2FA+passkey on a fresh account

def strip_ansi(b: bytes) -> bytes:
    b = ansi_re.sub(b"", b)
    b = re.sub(rb"\x1b\][0-9;]*\x07", b"", b)
    b = re.sub(rb"[\x00-\x08\x0b-\x1f]", b"", b)
    return b

try:
    while time.time() < deadline:
        rlist, _, _ = select.select([master_fd], [], [], 0.3)
        if rlist:
            try:
                chunk = os.read(master_fd, 4096)
            except OSError:
                break
            if not chunk:
                # PTY EOF doesn't mean the gws callback server died — check.
                try:
                    wpid, _ = os.waitpid(pid, os.WNOHANG)
                    if wpid != 0:
                        break
                except ChildProcessError:
                    break
                time.sleep(0.5)
                continue
            buf += chunk
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()

        # Evaluate state on EVERY tick, not only when select() fired.
        clean = strip_ansi(buf)

        if not sent_confirm and (b"Confirm" in clean and b"Cancel" in clean):
            if confirm_at is None:
                confirm_at = time.time() + 0.8
            elif time.time() >= confirm_at:
                os.write(master_fd, b"\r")
                sent_confirm = True
                sys.stdout.buffer.write(b"\n[driver] sent CR to scope picker\n")
                sys.stdout.buffer.flush()

        if not url_emitted:
            m = url_re.search(buf) or url_re.search(clean)
            if m:
                url = m.group(0).decode("utf-8", errors="replace")
                sys.stdout.buffer.write(
                    f"\n[driver] URL_CAPTURED {url}\n".encode()
                )
                sys.stdout.buffer.flush()
                url_emitted = True

        if b"Authentication successful" in clean:
            sys.stdout.buffer.write(b"\n[driver] AUTH_SUCCESS\n")
            sys.stdout.buffer.flush()
            break

        try:
            wpid, status = os.waitpid(pid, os.WNOHANG)
            if wpid != 0:
                sys.stdout.buffer.write(
                    f"\n[driver] child exited status={status}\n".encode()
                )
                break
        except ChildProcessError:
            break
finally:
    try:
        os.close(master_fd)
    except OSError:
        pass

sys.exit(0 if url_emitted else 3)

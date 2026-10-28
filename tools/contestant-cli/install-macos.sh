#!/bin/bash
# NovaJudge submit installer. Uses only tools included with macOS (Bash 3.2+).
set -euo pipefail

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'USAGE'
Install:   bash install-macos.sh --url https://judge.example.com
Offline:   bash install-macos.sh --url https://judge.example.com --source /path/to/submit-macos
Uninstall: bash install-macos.sh --uninstall

macOS only. No sudo, package manager, or extra runtime is required.
Installs submit into ~/.local/bin and configures zsh and bash PATH.
Run the install command again to update or change the default server.
Uninstall keeps your login; run submit logout first to remove it.
USAGE
}

SERVER_URL=''
LOCAL_SOURCE=''
UNINSTALL=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --url)
      [ "$#" -ge 2 ] && [ -n "$2" ] || die '--url requires a server URL.'
      SERVER_URL="$2"; shift 2 ;;
    --uninstall) UNINSTALL=true; shift ;;
    --source)
      [ "$#" -ge 2 ] && [ -n "$2" ] || die '--source requires a bundled macOS submit script.'
      LOCAL_SOURCE="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[ "$(/usr/bin/uname -s)" = Darwin ] || die 'This installer supports macOS only.'
[ -n "${HOME:-}" ] && [ "$HOME" != / ] || die 'A user home directory is required.'
[ "$(id -u)" -ne 0 ] || die 'Run this installer as your normal user, without sudo.'

INSTALL_DIR="$HOME/.local/share/novajudge-submit"
BIN_DIR="$HOME/.local/bin"
COMMAND="$BIN_DIR/submit"
MARKER='NovaJudge macOS submit installation v1'
PATH_START='# >>> NovaJudge submit >>>'
PATH_END='# <<< NovaJudge submit <<<'
ZSH_DIR="${ZDOTDIR:-$HOME}"
RC_FILES=("$ZSH_DIR/.zprofile" "$ZSH_DIR/.zshrc" "$HOME/.bashrc")
# Do not create .bash_profile when that would shadow an existing login profile.
if $UNINSTALL; then
  # A newer login profile may have superseded the one used at installation.
  RC_FILES+=("$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile")
elif [ -f "$HOME/.bash_profile" ]; then
  RC_FILES+=("$HOME/.bash_profile")
elif [ -f "$HOME/.bash_login" ]; then
  RC_FILES+=("$HOME/.bash_login")
elif [ -f "$HOME/.profile" ]; then
  RC_FILES+=("$HOME/.profile")
else
  RC_FILES+=("$HOME/.bash_profile")
fi

owns_install() {
  [ -d "$INSTALL_DIR" ] && [ ! -L "$INSTALL_DIR" ] &&
    [ -f "$INSTALL_DIR/.install-marker" ] &&
    /usr/bin/grep -Fqx "$MARKER" "$INSTALL_DIR/.install-marker"
}
owns_command() {
  [ -f "$COMMAND" ] && [ ! -L "$COMMAND" ] &&
    /usr/bin/grep -Fqx "# $MARKER" "$COMMAND"
}
valid_path_blocks() {
  /usr/bin/awk -v start="$PATH_START" -v end="$PATH_END" '
    $0 == start { if (inside) invalid = 1; inside = 1; next }
    $0 == end { if (!inside) invalid = 1; inside = 0; next }
    END { exit (invalid || inside) ? 1 : 0 }
  ' "$1"
}

STAGING=''
COMMAND_TMP=''
RC_TMP=''
BACKUP=''
cleanup() {
  [ -z "$STAGING" ] || /bin/rm -rf "$STAGING"
  [ -z "$COMMAND_TMP" ] || /bin/rm -f "$COMMAND_TMP"
  [ -z "$RC_TMP" ] || /bin/rm -f "$RC_TMP"
  if [ -n "$BACKUP" ] && [ -d "$BACKUP" ]; then
    if [ ! -e "$INSTALL_DIR" ]; then /bin/mv "$BACKUP" "$INSTALL_DIR"; fi
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if $UNINSTALL; then
  [ -z "$SERVER_URL" ] || die 'Use --url for installation or --uninstall for removal.'
  [ -z "$LOCAL_SOURCE" ] || die 'Use --source for installation, not removal.'
  if [ -e "$COMMAND" ] || [ -L "$COMMAND" ]; then
    owns_command || die "Refusing to remove another command: $COMMAND"
  fi
  if [ -e "$INSTALL_DIR" ] || [ -L "$INSTALL_DIR" ]; then
    owns_install || die "Refusing to remove an unrecognized directory: $INSTALL_DIR"
  fi
  for rc in "${RC_FILES[@]}"; do
    [ -f "$rc" ] || continue
    valid_path_blocks "$rc" || die "Malformed NovaJudge PATH block in $rc; repair it before uninstalling."
    if /usr/bin/grep -Fqx "$PATH_START" "$rc"; then
      [ -w "$rc" ] || die "Cannot safely remove the PATH block from $rc."
    fi
  done
  [ ! -e "$COMMAND" ] || /bin/rm "$COMMAND"
  [ ! -e "$INSTALL_DIR" ] || /bin/rm -rf "$INSTALL_DIR"
  for rc in "${RC_FILES[@]}"; do
    [ -f "$rc" ] || continue
    /usr/bin/grep -Fqx "$PATH_START" "$rc" || continue
    RC_TMP=$(/usr/bin/mktemp "${TMPDIR:-/tmp}/novajudge-path.XXXXXX")
    /usr/bin/awk -v start="$PATH_START" -v end="$PATH_END" '
      $0 == start { skip = 1; next }
      $0 == end { skip = 0; next }
      !skip { print }
    ' "$rc" > "$RC_TMP"
    /bin/cat "$RC_TMP" > "$rc"
    /bin/rm "$RC_TMP"; RC_TMP=''
  done
  printf 'NovaJudge submit uninstalled. Login configuration was kept.\n'
  exit 0
fi

[ -n "$SERVER_URL" ] || die 'Pass --url with the NovaJudge server address.'
while [ "${SERVER_URL%/}" != "$SERVER_URL" ]; do SERVER_URL="${SERVER_URL%/}"; done
# Validate and encode without shell interpolation. JXA is built into macOS.
DEFAULTS=$(printf '%s' "$SERVER_URL" | /usr/bin/osascript -l JavaScript -e '
  ObjC.import("Foundation");
  var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  var url = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
  if (!/^https?:\/\/[^\s/?#@]+(?:\/[^\s?#]*)?$/.test(url)) throw new Error("Use an http(s) server URL without credentials, query, or fragment.");
  JSON.stringify({baseUrl: url});
') || die 'Invalid server URL.'

if [ -e "$COMMAND" ] || [ -L "$COMMAND" ]; then
  owns_command || die "Another submit command already exists at $COMMAND. Move it before installing."
fi
if [ -e "$INSTALL_DIR" ] || [ -L "$INSTALL_DIR" ]; then
  owns_install || die "Refusing to overwrite an unrecognized directory: $INSTALL_DIR"
fi
for rc in "${RC_FILES[@]}"; do
  if [ -e "$rc" ]; then
    [ -f "$rc" ] && [ -w "$rc" ] || die "Cannot update shell profile: $rc"
    valid_path_blocks "$rc" || die "Malformed NovaJudge PATH block in $rc; repair it before installing."
  fi
done

/bin/mkdir -p "$HOME/.local/share" "$BIN_DIR" "$ZSH_DIR"
STAGING=$(/usr/bin/mktemp -d "$HOME/.local/share/.novajudge-submit.XXXXXX")
if [ -n "$LOCAL_SOURCE" ]; then
  [ -f "$LOCAL_SOURCE" ] && [ ! -L "$LOCAL_SOURCE" ] || die 'The bundled submit source must be a regular file.'
  printf 'Installing bundled submit for %s…\n' "$SERVER_URL"
  /bin/cp "$LOCAL_SOURCE" "$STAGING/submit" || die 'Cannot copy bundled submit; the previous installation was kept.'
else
  printf 'Downloading submit from %s…\n' "$SERVER_URL"
  /usr/bin/curl --fail --silent --show-error --location \
    --proto '=http,https' --proto-redir '=http,https' \
    --connect-timeout 10 --max-time 60 \
    --output "$STAGING/submit" -- "$SERVER_URL/api/cli/download" || die 'Download failed; the previous installation was kept.'
fi
/bin/bash -n "$STAGING/submit" || die 'The server did not return a valid submit script.'
/usr/bin/grep -Fqx '# NovaJudge native macOS submit' "$STAGING/submit" || die 'The server did not return the macOS submit client.'
printf '%s\n' "$DEFAULTS" > "$STAGING/submit-defaults.json"
printf '%s\n' "$MARKER" > "$STAGING/.install-marker"
/bin/chmod 755 "$STAGING/submit"
/bin/chmod 600 "$STAGING/submit-defaults.json"
"$STAGING/submit" --help > /dev/null || die 'The downloaded submit client cannot run on this Mac.'

COMMAND_TMP=$(/usr/bin/mktemp "$BIN_DIR/.submit.XXXXXX")
{
  printf '#!/bin/bash\n# %s\n' "$MARKER"
  printf 'exec %q "$@"\n' "$INSTALL_DIR/submit"
} > "$COMMAND_TMP"
/bin/chmod 755 "$COMMAND_TMP"
if [ -d "$INSTALL_DIR" ]; then
  BACKUP="$STAGING.previous"
  /bin/mv "$INSTALL_DIR" "$BACKUP"
fi
/bin/mv "$STAGING" "$INSTALL_DIR"; STAGING=''
/bin/mv -f "$COMMAND_TMP" "$COMMAND"; COMMAND_TMP=''
[ -z "$BACKUP" ] || /bin/rm -rf "$BACKUP"
BACKUP=''

for rc in "${RC_FILES[@]}"; do
  if [ -f "$rc" ] && /usr/bin/grep -Fqx "$PATH_START" "$rc"; then continue; fi
  cat >> "$rc" <<'PROFILE'

# >>> NovaJudge submit >>>
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
# <<< NovaJudge submit <<<
PROFILE
done

printf '\nInstalled: %s\nServer: %s\n' "$COMMAND" "$SERVER_URL"
cat <<'DONE'

Open a new terminal, or run this in your current terminal:
  export PATH="$HOME/.local/bin:$PATH"

Then submit from your source directory:
  submit A.cpp

The first submission opens a browser to sign in and connect this computer.
The administrator selects the contest; no account or contest input is needed here.
You can also run submit login to connect before submitting.

Run submit --help for more options. No additional runtime was installed.
DONE

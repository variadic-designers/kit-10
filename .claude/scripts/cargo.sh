#!/usr/bin/env bash
# Wrapper so `cargo build/test/check` across this repo's plugin crates (and the sibling
# taf_can_do/Vellum repo) can be allowlisted by SCRIPT PATH instead of by raw shell command --
# the safety property is that `target` is validated against a fixed enum below, not trusted
# free text, so allowlisting `Bash(.claude/scripts/cargo.sh *)` can't cd anywhere arbitrary.
# Extra args after <action> <target> pass straight through to cargo (e.g. a test name filter) --
# that's no more permissive than the raw `Bash(cargo test *)` rule this replaces.
#
# Usage: cargo.sh <build|test|check> <charter|fontavious|tenner|vellum> [cargo args...]
set -euo pipefail

action="${1:?usage: cargo.sh <build|test|check> <charter|fontavious|tenner|vellum> [cargo args...]}"
target="${2:?usage: cargo.sh <build|test|check> <charter|fontavious|tenner|vellum> [cargo args...]}"
shift 2

case "$action" in
	build | test | check) ;;
	*)
		echo "unknown action: $action (expected build|test|check)" >&2
		exit 1
		;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
kit10_root="$(cd "$script_dir/../.." && pwd)"

extra_flags=()
case "$target" in
	charter) dir="$kit10_root/plugins/charter" ;;
	fontavious) dir="$kit10_root/plugins/fontavious" ;;
	tenner) dir="$kit10_root/plugins/tenner" ;;
	# Native lib only -- the wasm32 release build (the actual deploy artifact) is a separate,
	# deliberately un-scripted step since it writes tracked files (static/*.wasm); this wrapper
	# only covers the native dev-loop checks.
	vellum) dir="$(cd "$kit10_root/../taf_can_do" && pwd)" && extra_flags=(--no-default-features --lib) ;;
	*)
		echo "unknown target: $target (expected charter|fontavious|tenner|vellum)" >&2
		exit 1
		;;
esac

cd "$dir"
echo "+ (cd $dir && cargo $action ${extra_flags[*]:-} $*)" >&2
exec cargo "$action" "${extra_flags[@]}" "$@"

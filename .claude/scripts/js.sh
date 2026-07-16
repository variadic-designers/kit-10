#!/usr/bin/env bash
# Wrapper so npm/pnpm check/test/build across the editor root and manager/ can be allowlisted
# by SCRIPT PATH instead of raw shell command -- see cargo.sh's header comment for the same
# reasoning (target is validated against a fixed enum, not trusted free text).
#
# Usage: js.sh <check|test|build> <root|manager> [extra args...]
set -euo pipefail

action="${1:?usage: js.sh <check|test|build> <root|manager> [extra args...]}"
target="${2:?usage: js.sh <check|test|build> <root|manager> [extra args...]}"
shift 2

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
kit10_root="$(cd "$script_dir/../.." && pwd)"

case "$target" in
	root)
		dir="$kit10_root"
		pm="npm"
		case "$action" in check | test | build) ;; *)
			echo "unknown action '$action' for target 'root' (expected check|test|build)" >&2
			exit 1
			;;
		esac
		;;
	manager)
		dir="$kit10_root/manager"
		pm="pnpm"
		# manager/package.json has no "check" script -- "build" (tsc) is its typecheck equivalent.
		case "$action" in build | test) ;; *)
			echo "unknown action '$action' for target 'manager' (expected build|test)" >&2
			exit 1
			;;
		esac
		;;
	*)
		echo "unknown target: $target (expected root|manager)" >&2
		exit 1
		;;
esac

cd "$dir"
echo "+ (cd $dir && $pm run $action $*)" >&2
exec "$pm" run "$action" "$@"

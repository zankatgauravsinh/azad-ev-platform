#!/usr/bin/env bash
# GitHub Releases for the version tags (vX.Y.Z, vX.Y.Z-rc.N). Needs the GitHub CLI, logged in: `gh auth login`.
#
#   scripts/github-release.sh publish v3.8.0-rc.1   # a Release for an existing tag; notes = its CHANGELOG section;
#                                                   # an -rc tag is a pre-release, never "Latest"
#   scripts/github-release.sh promote v3.7.0        # the version now in production: a full release, marked Latest
#
# "Latest" on GitHub = what runs in production. Promote right after a deploy is confirmed working.
set -euo pipefail

cmd="${1:-}"
tag="${2:-}"
[[ "$cmd" =~ ^(publish|promote)$ && "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$ ]] || {
  echo "usage: $0 publish|promote vX.Y.Z[-rc.N]" >&2
  exit 2
}
command -v gh >/dev/null || { echo "The GitHub CLI (gh) is not installed: brew install gh, then gh auth login" >&2; exit 1; }
cd "$(dirname "$0")/.."
git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null || { echo "Tag $tag is not on GitHub — push it first: git push origin $tag" >&2; exit 1; }

version="${tag#v}"
base="${version%%-*}"
# The CHANGELOG section of the version: from "## [X.Y.Z]" to the next "## [".
notes="$(awk -v v="$base" 'index($0, "## [" v "]") == 1 { on = 1; next } /^## \[/ && on { exit } on' CHANGELOG.md)"
[[ -n "${notes//[[:space:]]/}" ]] || notes="See CHANGELOG.md."

if [[ "$cmd" == publish ]]; then
  if [[ "$version" == *-rc.* ]]; then
    gh release create "$tag" --verify-tag --title "$tag (release candidate)" --notes "$notes" --prerelease --latest=false
  else
    gh release create "$tag" --verify-tag --title "$tag" --notes "$notes" --latest=false
  fi
  echo "Published $tag. When it is deployed and working: $0 promote $tag"
else
  gh release view "$tag" >/dev/null 2>&1 || gh release create "$tag" --verify-tag --title "$tag" --notes "$notes" --latest=false
  gh release edit "$tag" --prerelease=false --latest
  echo "$tag is now Latest — the version in production."
fi

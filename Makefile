# Development shorthands.
#
# Every target is a thin wrapper over an npm script or a git command — CI calls
# those directly, so this file can never quietly become a second source of truth.
# `make help` lists everything.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# Every target here is a step in a sequence, not an independent unit of work:
# `gate` checks dist/ after building it, `compat` inspects the same dist/. Under
# `make -j` prerequisites run in parallel, which would let those checks start
# before the build that produces what they read.
.NOTPARALLEL:

# The provider credentials in .env.dev are loaded by the test setup, so a plain
# `npm test` runs the e2e suites against the live DeepL API and bills it. Clearing
# both variables first makes the run self-skip those suites exactly as CI does —
# dotenv does not override a variable that is already set.
OFFLINE := DEEPL_API_KEY="" LIBRETRANSLATE_URL=""

.PHONY: help install build clean typecheck format format-check test test-offline test-watch \
	coverage e2e compat compat-types compat-package smoke audit verify-dist gate \
	version-patch version-minor version-major push-release

help: ## List the available targets
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies the way CI does
	npm ci --ignore-scripts

clean: ## Remove dist/
	npm run clean

build: ## Compile to dist/ and rewrite the @/ aliases
	npm run build

typecheck: ## Type-check src and tests without emitting
	npm run typecheck

format: ## Rewrite src and tests with prettier
	npm run format

format-check: ## Fail if src or tests are unformatted
	npm run format:check

test: ## Run every suite, e2e included when .env.dev has credentials
	npm test

test-offline: ## Run the suites CI runs — no provider credentials, e2e self-skips
	$(OFFLINE) npm test

test-watch: ## Re-run tests on change
	npm run test:watch

coverage: ## Coverage report with CI's numbers, into coverage/
	$(OFFLINE) npm run test:coverage

e2e: ## Run the live provider suites — costs real API quota
	npm run test:deepl-e2e && npm run test:libre-e2e

compat: build compat-types compat-package ## Prove the TypeScript and packaging claims (needs dist/)

compat-types: ## Type-check the sample consumer against every supported TypeScript
	npm run compat:types

compat-package: ## Resolve and lint the package the way a consumer installs it
	npm run compat:package

smoke: ## Pack the tarball, install it into a scratch project and drive it
	npm run smoke

audit: ## Audit the runtime dependency surface
	npm run audit:prod

# `! grep ... dist/` on its own passes when dist/ is absent: grep exits 2 with
# "No such file or directory" and `!` turns that into success, so the check
# would report a clean build where there is no build at all. The directory has
# to exist, and only grep's exit 1 — matched nothing — counts as clean.
verify-dist: ## Fail if a @/ alias survived into dist/ (needs a build)
	@test -d dist || { echo "dist/ is missing — run 'make build' first" >&2; exit 1; }
	grep -r 'require("@/' dist/; test $$? -eq 1

gate: format-check typecheck build verify-dist test-offline ## What has to pass before a push

version-patch: ## Bump the patch version and write the v<version> tag
	npm version patch

version-minor: ## Bump the minor version and write the v<version> tag
	npm version minor

version-major: ## Bump the major version and write the v<version> tag
	npm version major

push-release: ## Push the branch with its tag — only once the release merge is on main
	git push --follow-tags

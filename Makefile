UUID := mouse-tickler@dicostanzo.com
ZIP  := build/$(UUID).shell-extension.zip
SRC  := $(wildcard src/*.js src/metadata.json src/schemas/*.xml)

.PHONY: pack test-unit test-shell clean

pack: $(ZIP)

$(ZIP): $(SRC)
	@mkdir -p build
	gnome-extensions pack src --force --out-dir build \
		--extra-source=detector.js --extra-source=sprite.js

# Light: plain gjs, seconds. Safe to run any time.
test-unit:
	gjs -m tests/detector_test.js

# Heavy: headless gnome-shell. Ask pcrecdev1 for a window first (CLAUDE.md).
# Verdict is the script's own RESULT line: the shell's exit code also
# reflects unrelated perf-helper teardown races.
test-shell: $(ZIP)
	-tests/spikes/run-spike.sh tests/shell/shake.js build/test-shell.log $(ZIP)
	@grep -E '^(FAIL|RESULT)' build/test-shell.log
	@grep -q '^RESULT OK' build/test-shell.log

clean:
	rm -rf build

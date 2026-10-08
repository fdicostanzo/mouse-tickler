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
test-shell: $(ZIP)
	tests/spikes/run-spike.sh tests/shell/shake.js build/test-shell.log $(ZIP)

clean:
	rm -rf build

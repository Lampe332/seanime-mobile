build-all:
	rm -rf ../web
	rm -rf ../web-denshi
	npm run build
	cp -r out ../web
	npm run build:denshi
	cp -r out-denshi ../web-denshi
	rm -rf ../seanime-denshi/web-denshi
	cp -r ../web-denshi ../seanime-denshi/web-denshi

build-web:
	rm -rf ../web
	npm run build
	cp -r out ../web

build-denshi:
	rm -rf ../web-denshi
	npm run build:denshi
	cp -r out-denshi ../web-denshi
	rm -rf ../seanime-denshi/web-denshi
	cp -r ../web-denshi ../seanime-denshi/web-denshi

build-denshi-and-sidecar-mac:
	rm -rf ../web-denshi
	npm run build:denshi
	cp -r out-denshi ../web-denshi
	rm -rf ../seanime-denshi/web-denshi
	cp -r ../web-denshi ../seanime-denshi/web-denshi
	go build -tags ncgo -o ../seanime-denshi/binaries/seanime-server-darwin-arm64 -trimpath -ldflags "-s -w" ../main.go


.PHONY: build-all build-web build-denshi build-denshi-and-sidecar-mac

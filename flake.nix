{
  # Use nixpkgs-unstable for latest packages with basic CI stability
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
    rust-overlay,
  }:
    flake-utils.lib.eachDefaultSystem
    (system: let
      overlays = [ (import rust-overlay) ];
      pkgs = import nixpkgs {
        inherit system overlays;
        config.allowUnfree = true;  # for claude-code
      };

        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          targets = [ "wasm32-unknown-unknown" ];
          extensions = [ "rust-src" "rust-analyzer" ];
        };

        # Hastily repacked xtp binary
        xtp-cli = pkgs.stdenv.mkDerivation rec {
          pname = "xtp-cli";
          version = "latest";

          src = pkgs.fetchurl {
            url = let
              # Dynamic platform mapping for Dylibso's distribution paths
              target = {
                "x86_64-linux"   = "linux-amd64";
                "aarch64-linux"  = "linux-arm64";
                "x86_64-darwin"  = "darwin-amd64";
                "aarch64-darwin" = "darwin-arm64";
              }.${system} or "linux-amd64";
            in "https://static.dylibso.com/cli/bin/xtp-${target}";
            
            hash = {
              "x86_64-linux"   = "sha256-ZYjuW/CseuRf7BkDDiaZqpk0EXibNYdj6tqlGc1EsvM=";
              "aarch64-linux"  = "sha256-g6RFArGm2qFACcL+WnReHLcSGuSymZytlC4MkvZwvyo=";
              "x86_64-darwin"  = "sha256-Eqd4LknoYWrZS8P+bO/HK3sDTBBgPsvqWa071DHep0I=";
              "aarch64-darwin" = "sha256-Z6fdx2j1Px/Xv0e76CbIPtMOfH12P7e8KIAp63R+N9M=";

            }.${system} or "sha256-ZYjuW/CseuRf7BkDDiaZqpk0EXibNYdj6tqlGc1EsvM=";
          };

          # Conditionally patch the dynamic linker/ELF strings ONLY on Linux environments
          nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.autoPatchelfHook ];
          buildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.stdenv.cc.cc.lib pkgs.zlib ];

          dontUnpack = true;

          installPhase = ''
            mkdir -p $out/bin
            cp $src $out/bin/xtp
            chmod +x $out/bin/xtp
          '';
        };
    in {
      devShells.default = pkgs.mkShell {
        buildInputs = [
          rustToolchain
          pkgs.nodejs_22
          pkgs.pnpm
          pkgs.extism-js
          xtp-cli

          # WASM tooling
          pkgs.wasm-pack        # Vellum rebuild (taf_can_do → kit10/src/lib/vellum)
          pkgs.binaryen         # wasm-opt manual access

          # Rust dev tools
          pkgs.cargo-watch      # Auto-rebuild on file changes

          pkgs.claude-code
          pkgs.opencode
        ];
      };
    });
}

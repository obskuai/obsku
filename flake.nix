{
  description = "Obsku - Plugin-first offensive security agent framework";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            nodejs
            pnpm
            nmap
            zig
            awscli2
            just
          ];

          shellHook = ''
            echo "Obsku dev shell activated"
            echo "Available: bun, node, pnpm, nmap, zig, aws"
          '';
        };
      });
}

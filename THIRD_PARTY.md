# Third-party software

The distributed package contains a WebAssembly build of
[Delaunay32](https://github.com/morishuz/delaunay32), licensed under MIT and
pinned at version 0.7.0 (commit `d5c10aa`). Source builds fetch this exact
revision through CMake FetchContent.

The generated WebAssembly and JavaScript loader are produced with Emscripten
6.0.6. Emscripten's compiler toolchain is not included in the npm package.
The package has no runtime JavaScript dependencies.

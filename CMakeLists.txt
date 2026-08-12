cmake_minimum_required(VERSION 3.21)
project(delaunay32_wasm VERSION 0.1.0 LANGUAGES CXX)

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "delaunay32-wasm must be configured through emcmake")
endif()

set(DELAUNAY32_BUILD_BENCHMARKS OFF CACHE BOOL "" FORCE)
set(DELAUNAY32_BUILD_EXTRAS ON CACHE BOOL "" FORCE)
set(DELAUNAY32_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(DELAUNAY32_BUILD_TESTS OFF CACHE BOOL "" FORCE)

include(FetchContent)
FetchContent_Declare(
    delaunay32
    GIT_REPOSITORY https://github.com/morishuz/delaunay32.git
    GIT_TAG ae2d0cf9167deefd0d180e39a30be3cc8f0b0698
)
FetchContent_MakeAvailable(delaunay32)

add_executable(delaunay32_wasm src/bindings.cpp)
target_link_libraries(delaunay32_wasm PRIVATE delaunay32::extras)
target_compile_features(delaunay32_wasm PRIVATE cxx_std_17)

# Catching is required in the core and adapter so no C++ exception can cross
# the JavaScript boundary. LTO is applied to both targets for dead-code removal.
set(DELAUNAY32_COMPILE_TARGETS delaunay32 delaunay32_extras delaunay32_wasm)
foreach(target ${DELAUNAY32_COMPILE_TARGETS})
    target_compile_options(${target} PRIVATE -fexceptions -flto)
endforeach()

set(DELAUNAY32_EXPORT_NAMES
    _malloc
    _free
    _d32_create
    _d32_destroy
    _d32_set_points_i32
    _d32_set_points_f32
    _d32_set_points_f64
    _d32_set_constraints
    _d32_set_polygons
    _d32_sample_triangulate_f32
    _d32_sample_triangulate_f64
    _d32_triangulate
    _d32_quantize_f32
    _d32_quantize_f64
    _d32_error_code
    _d32_error_message
    _d32_triangles_data
    _d32_triangles_size
    _d32_halfedges_data
    _d32_halfedges_size
    _d32_hull_data
    _d32_hull_size
    _d32_representatives_data
    _d32_representatives_size
    _d32_quantized_points_data
    _d32_quantized_points_size
    _d32_report_predicate_width
    _d32_report_actual_thread_count
    _d32_report_input_points
    _d32_report_unique_points
    _d32_report_collapsed_points
    _d32_quantization_origin_x
    _d32_quantization_origin_y
    _d32_quantization_scale
    _d32_quantization_grid_step
    _d32_quantization_max_coordinate_error
    _d32_quantization_unique_points
    _d32_quantization_collapsed_points
    _d32_pipeline_boundary_points
    _d32_pipeline_generated_points
    _d32_pipeline_sampling_milliseconds
    _d32_pipeline_quantization_milliseconds
    _d32_pipeline_triangulation_milliseconds
)
set(DELAUNAY32_QUOTED_EXPORTS ${DELAUNAY32_EXPORT_NAMES})
list(TRANSFORM DELAUNAY32_QUOTED_EXPORTS PREPEND "'")
list(TRANSFORM DELAUNAY32_QUOTED_EXPORTS APPEND "'")
list(JOIN DELAUNAY32_QUOTED_EXPORTS "," DELAUNAY32_EXPORTED_FUNCTIONS)
set(DELAUNAY32_EXPORTED_FUNCTIONS "[${DELAUNAY32_EXPORTED_FUNCTIONS}]")

function(delaunay32_configure_emscripten_target target export_name)
    target_link_options(
        ${target}
        PRIVATE
        -fexceptions
        -flto
        --no-entry
        "-sEXPORTED_FUNCTIONS=${DELAUNAY32_EXPORTED_FUNCTIONS}"
        "-sEXPORTED_RUNTIME_METHODS=['HEAPU8','HEAP32','HEAPU32','HEAPF32','HEAPF64']"
        "-sINCOMING_MODULE_JS_API=['locateFile']"
        -sMODULARIZE=1
        -sEXPORT_ES6=1
        -sENVIRONMENT=web,worker
        -sALLOW_MEMORY_GROWTH=1
        -sINITIAL_MEMORY=16777216
        -sMAXIMUM_MEMORY=2147483648
        -sFILESYSTEM=0
        -sDYNAMIC_EXECUTION=0
        -sNO_EXIT_RUNTIME=1
        -sSTRICT=1
    )
    target_link_options(${target} PRIVATE "-sEXPORT_NAME=${export_name}")
endfunction()

delaunay32_configure_emscripten_target(
    delaunay32_wasm
    createDelaunay32Module)

if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    target_compile_options(delaunay32 PRIVATE -O0 -gsource-map)
    target_compile_options(delaunay32_extras PRIVATE -O0 -gsource-map)
    target_compile_options(delaunay32_wasm PRIVATE -O0 -gsource-map)
    target_link_options(delaunay32_wasm PRIVATE -O0 -gsource-map -sASSERTIONS=2)
else()
    target_compile_options(delaunay32 PRIVATE -O3)
    target_compile_options(delaunay32_extras PRIVATE -O3)
    target_compile_options(delaunay32_wasm PRIVATE -O3)
    target_link_options(delaunay32_wasm PRIVATE -O3 -sASSERTIONS=0)
endif()

set_target_properties(
    delaunay32_wasm
    PROPERTIES
        OUTPUT_NAME "delaunay32-module"
        SUFFIX ".mjs"
)

// SPDX-License-Identifier: MIT

#include "delaunay32/delaunay.hpp"
#include "delaunay32/extras/sampling.hpp"
#include "delaunay32/quantization.hpp"

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <limits>
#include <new>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

namespace {

enum class ErrorCode : std::uint32_t {
    None = 0,
    InvalidInput = 1,
    OutOfMemory = 2,
    Internal = 3,
};

struct QuantizationArguments {
    std::uint32_t mode = 0;
    double grid_step = 0.0;
    double origin_x = 0.0;
    double origin_y = 0.0;
    double scale = 0.0;
    double maximum_error = 0.0;
    std::uint32_t collision_policy = 0;
};

struct SamplingArguments {
    std::uint32_t mode = 0;
    std::uint32_t point_count = 0;
    std::uint32_t seed = 0;
    double jitter = 0.0;
    std::uint32_t candidates_per_point = 0;
    std::uint32_t attempts_per_point = 0;
};

struct PipelineReport {
    std::uint32_t boundary_points = 0;
    std::uint32_t generated_points = 0;
    double sampling_milliseconds = 0.0;
    double quantization_milliseconds = 0.0;
    double triangulation_milliseconds = 0.0;
};

struct Context {
    delaunay32::Triangulator triangulator;
    delaunay32::TriangulationResult result;
    delaunay32::QuantizationResult quantization;
    std::vector<std::int32_t> halfedges;
    ErrorCode error_code = ErrorCode::None;
    std::string error_message;
    PipelineReport pipeline_report;

    Context() {
        error_message.reserve(512);
        delaunay32::TriangulationOptions options;
        options.thread_count = 1;
        triangulator.set_options(options);
    }

    void clear_error() {
        error_code = ErrorCode::None;
        error_message.clear();
    }

    void set_error(ErrorCode code, const char* message) noexcept {
        error_code = code;
        try {
            const std::size_t length = std::min<std::size_t>(
                std::char_traits<char>::length(message),
                511);
            error_message.assign(message, length);
        } catch (...) {
            error_message.clear();
        }
    }

    void clear_result() {
        result = {};
        halfedges.clear();
    }

    void clear_pipeline_report() {
        pipeline_report = {};
    }
};

static_assert(
    std::is_standard_layout_v<delaunay32::Triangle> &&
        sizeof(delaunay32::Triangle) == 3 * sizeof(std::uint32_t),
    "Triangle must remain three contiguous uint32 values");
static_assert(
    std::is_standard_layout_v<delaunay32::Point> &&
        sizeof(delaunay32::Point) == 2 * sizeof(std::int32_t),
    "Point must remain two contiguous int32 values");

Context* context_from_handle(std::uintptr_t handle) noexcept {
    return reinterpret_cast<Context*>(handle);
}

template <typename Operation>
std::uint32_t guarded(Context* context, Operation&& operation) noexcept {
    if (context == nullptr) {
        return static_cast<std::uint32_t>(ErrorCode::Internal);
    }
    context->clear_error();
    try {
        operation();
        return static_cast<std::uint32_t>(ErrorCode::None);
    } catch (const std::invalid_argument& error) {
        context->set_error(ErrorCode::InvalidInput, error.what());
    } catch (const std::logic_error& error) {
        context->set_error(ErrorCode::InvalidInput, error.what());
    } catch (const std::bad_alloc& error) {
        context->set_error(ErrorCode::OutOfMemory, error.what());
    } catch (const std::exception& error) {
        context->set_error(ErrorCode::Internal, error.what());
    } catch (...) {
        context->set_error(ErrorCode::Internal, "unknown C++ exception");
    }
    return static_cast<std::uint32_t>(context->error_code);
}

template <typename Coordinate>
std::vector<delaunay32::FloatPoint> copy_float_points(
    const Coordinate* coordinates,
    std::uint32_t point_count) {
    if (coordinates == nullptr && point_count != 0) {
        throw std::invalid_argument("point coordinate pointer is null");
    }
    std::vector<delaunay32::FloatPoint> points;
    points.reserve(point_count);
    for (std::uint32_t index = 0; index < point_count; ++index) {
        const std::size_t offset = static_cast<std::size_t>(index) * 2;
        points.push_back({
            static_cast<double>(coordinates[offset]),
            static_cast<double>(coordinates[offset + 1]),
        });
    }
    return points;
}

delaunay32::QuantizationOptions make_quantization_options(
    const QuantizationArguments& arguments) {
    delaunay32::QuantizationOptions options;
    switch (arguments.mode) {
        case 0:
            options.mode = delaunay32::QuantizationMode::Automatic;
            break;
        case 1:
            options.mode = delaunay32::QuantizationMode::GridStep;
            break;
        case 2:
            options.mode = delaunay32::QuantizationMode::FixedScale;
            break;
        default:
            throw std::invalid_argument("unknown quantization mode");
    }
    switch (arguments.collision_policy) {
        case 0:
            options.collision_policy =
                delaunay32::QuantizationCollisionPolicy::Allow;
            break;
        case 1:
            options.collision_policy =
                delaunay32::QuantizationCollisionPolicy::Reject;
            break;
        default:
            throw std::invalid_argument(
                "unknown quantization collision policy");
    }
    options.grid_step = arguments.grid_step;
    options.origin_x = arguments.origin_x;
    options.origin_y = arguments.origin_y;
    options.scale = arguments.scale;
    options.max_coordinate_error = arguments.maximum_error;
    return options;
}

template <typename Coordinate>
void quantize_into_context(
    Context& context,
    const Coordinate* coordinates,
    std::uint32_t point_count,
    const QuantizationArguments& arguments) {
    const auto points = copy_float_points(coordinates, point_count);
    context.quantization = delaunay32::quantize(
        points,
        make_quantization_options(arguments));
}

template <typename Coordinate>
std::uint32_t set_float_points(
    Context* context,
    const Coordinate* coordinates,
    std::uint32_t point_count,
    const QuantizationArguments& arguments) noexcept {
    return guarded(context, [&] {
        context->clear_result();
        quantize_into_context(
            *context,
            coordinates,
            point_count,
            arguments);
        context->triangulator.set_points(context->quantization.points);
    });
}

template <typename Coordinate>
std::uint32_t quantize_only(
    Context* context,
    const Coordinate* coordinates,
    std::uint32_t point_count,
    const QuantizationArguments& arguments) noexcept {
    return guarded(context, [&] {
        quantize_into_context(
            *context,
            coordinates,
            point_count,
            arguments);
    });
}

std::uintptr_t pointer_value(const void* pointer) noexcept {
    return reinterpret_cast<std::uintptr_t>(pointer);
}

std::vector<delaunay32::PolygonDomain> copy_polygons(
    const std::uint32_t* indices,
    std::uint32_t index_count,
    const std::uint32_t* ring_offsets,
    std::uint32_t ring_count,
    const std::uint32_t* domain_offsets,
    std::uint32_t domain_count) {
    if (domain_count == 0) {
        if (index_count != 0 || ring_count != 0) {
            throw std::invalid_argument(
                "polygon data is present without a domain");
        }
        return {};
    }
    if (indices == nullptr || ring_offsets == nullptr ||
        domain_offsets == nullptr) {
        throw std::invalid_argument("polygon pointer is null");
    }
    if (ring_offsets[0] != 0 || ring_offsets[ring_count] != index_count) {
        throw std::invalid_argument("invalid polygon ring offsets");
    }
    if (domain_offsets[0] != 0 ||
        domain_offsets[domain_count] != ring_count) {
        throw std::invalid_argument("invalid polygon domain offsets");
    }
    for (std::uint32_t ring = 0; ring < ring_count; ++ring) {
        if (ring_offsets[ring] > ring_offsets[ring + 1]) {
            throw std::invalid_argument(
                "polygon ring offsets are not monotonic");
        }
    }
    for (std::uint32_t domain = 0; domain < domain_count; ++domain) {
        if (domain_offsets[domain] >= domain_offsets[domain + 1]) {
            throw std::invalid_argument(
                "each polygon domain needs an outer ring");
        }
    }

    const auto copy_ring = [&](std::uint32_t ring) {
        return std::vector<std::uint32_t>(
            indices + ring_offsets[ring],
            indices + ring_offsets[ring + 1]);
    };
    std::vector<delaunay32::PolygonDomain> polygons;
    polygons.reserve(domain_count);
    for (std::uint32_t domain = 0; domain < domain_count; ++domain) {
        const std::uint32_t first_ring = domain_offsets[domain];
        const std::uint32_t last_ring = domain_offsets[domain + 1];
        delaunay32::PolygonDomain polygon;
        polygon.outer_ring = copy_ring(first_ring);
        polygon.holes.reserve(last_ring - first_ring - 1);
        for (std::uint32_t ring = first_ring + 1; ring < last_ring; ++ring) {
            polygon.holes.push_back(copy_ring(ring));
        }
        polygons.push_back(std::move(polygon));
    }
    return polygons;
}

void triangulate_context(Context& context, std::uint32_t result_detail) {
    delaunay32::TriangulationOptions options;
    options.thread_count = 1;
    switch (result_detail) {
        case 0:
            options.result_detail = delaunay32::ResultDetail::Triangles;
            break;
        case 1:
            options.result_detail = delaunay32::ResultDetail::Full;
            break;
        default:
            throw std::invalid_argument("unknown result detail");
    }
    context.triangulator.set_options(options);
    context.clear_result();
    context.result = context.triangulator.triangulate();
    context.halfedges.reserve(context.result.halfedges.size());
    for (const std::int64_t halfedge : context.result.halfedges) {
        if (halfedge < -1 ||
            halfedge > std::numeric_limits<std::int32_t>::max()) {
            throw std::length_error(
                "halfedge index exceeds the browser result range");
        }
        context.halfedges.push_back(static_cast<std::int32_t>(halfedge));
    }
}

template <typename Clock>
double elapsed_milliseconds(
    const typename Clock::time_point& start,
    const typename Clock::time_point& end) {
    return std::chrono::duration<double, std::milli>(end - start).count();
}

std::vector<delaunay32::FloatPoint> generate_samples(
    const delaunay32::extras::PointSampler& sampler,
    const SamplingArguments& arguments) {
    switch (arguments.mode) {
        case 0: {
            delaunay32::extras::UniformSamplingOptions options;
            options.point_count = arguments.point_count;
            options.seed = arguments.seed;
            options.attempts_per_point = arguments.attempts_per_point;
            return sampler.generate_uniform(options);
        }
        case 1: {
            delaunay32::extras::BlueNoiseSamplingOptions options;
            options.point_count = arguments.point_count;
            options.seed = arguments.seed;
            options.candidates_per_point = arguments.candidates_per_point;
            options.attempts_per_candidate = arguments.attempts_per_point;
            return sampler.generate_blue_noise(options);
        }
        case 2: {
            delaunay32::extras::JitteredGridSamplingOptions options;
            options.point_count = arguments.point_count;
            options.seed = arguments.seed;
            options.jitter = arguments.jitter;
            options.attempts_per_point = arguments.attempts_per_point;
            return sampler.generate_jittered_grid(options);
        }
        default:
            throw std::invalid_argument("unknown sampling mode");
    }
}

template <typename Coordinate>
std::uint32_t sample_and_triangulate(
    Context* context,
    const Coordinate* coordinates,
    std::uint32_t boundary_point_count,
    const std::uint32_t* indices,
    std::uint32_t index_count,
    const std::uint32_t* ring_offsets,
    std::uint32_t ring_count,
    const std::uint32_t* domain_offsets,
    std::uint32_t domain_count,
    const SamplingArguments& sampling,
    const QuantizationArguments& quantization,
    std::uint32_t result_detail) noexcept {
    return guarded(context, [&] {
        using Clock = std::chrono::steady_clock;
        context->clear_result();
        context->clear_pipeline_report();

        std::vector<delaunay32::FloatPoint> boundary_points =
            copy_float_points(coordinates, boundary_point_count);
        std::vector<delaunay32::PolygonDomain> polygons = copy_polygons(
            indices,
            index_count,
            ring_offsets,
            ring_count,
            domain_offsets,
            domain_count);
        if (polygons.empty()) {
            throw std::invalid_argument(
                "sampled polygon triangulation requires a polygon domain");
        }

        const auto sampling_start = Clock::now();
        delaunay32::extras::PointSampler sampler;
        sampler.set_polygon_interiors(boundary_points, polygons);
        std::vector<delaunay32::FloatPoint> sampled_points =
            generate_samples(sampler, sampling);
        const auto sampling_end = Clock::now();

        const auto quantization_start = Clock::now();
        boundary_points.reserve(
            boundary_points.size() + sampled_points.size());
        boundary_points.insert(
            boundary_points.end(),
            sampled_points.begin(),
            sampled_points.end());
        context->quantization = delaunay32::quantize(
            boundary_points,
            make_quantization_options(quantization));
        const auto quantization_end = Clock::now();

        const auto triangulation_start = Clock::now();
        context->triangulator.set_points(context->quantization.points);
        context->triangulator.set_constraints({});
        context->triangulator.set_polygons(std::move(polygons));
        triangulate_context(*context, result_detail);
        const auto triangulation_end = Clock::now();

        context->pipeline_report.boundary_points = boundary_point_count;
        context->pipeline_report.generated_points = sampling.point_count;
        context->pipeline_report.sampling_milliseconds =
            elapsed_milliseconds<Clock>(sampling_start, sampling_end);
        context->pipeline_report.quantization_milliseconds =
            elapsed_milliseconds<Clock>(
                quantization_start,
                quantization_end);
        context->pipeline_report.triangulation_milliseconds =
            elapsed_milliseconds<Clock>(
                triangulation_start,
                triangulation_end);
    });
}

}  // namespace

extern "C" {

std::uintptr_t d32_create() noexcept {
    try {
        return reinterpret_cast<std::uintptr_t>(new Context{});
    } catch (...) {
        return 0;
    }
}

void d32_destroy(std::uintptr_t handle) noexcept {
    delete context_from_handle(handle);
}

std::uint32_t d32_set_points_i32(
    std::uintptr_t handle,
    const std::int32_t* coordinates,
    std::uint32_t point_count) noexcept {
    Context* context = context_from_handle(handle);
    return guarded(context, [&] {
        if (coordinates == nullptr && point_count != 0) {
            throw std::invalid_argument("point coordinate pointer is null");
        }
        context->clear_result();
        context->quantization = {};
        std::vector<delaunay32::Point> points;
        points.reserve(point_count);
        for (std::uint32_t index = 0; index < point_count; ++index) {
            const std::size_t offset = static_cast<std::size_t>(index) * 2;
            points.push_back({coordinates[offset], coordinates[offset + 1]});
        }
        context->triangulator.set_points(points);
    });
}

std::uint32_t d32_set_points_f32(
    std::uintptr_t handle,
    const float* coordinates,
    std::uint32_t point_count,
    std::uint32_t mode,
    double grid_step,
    double origin_x,
    double origin_y,
    double scale,
    double maximum_error,
    std::uint32_t collision_policy) noexcept {
    return set_float_points(
        context_from_handle(handle),
        coordinates,
        point_count,
        QuantizationArguments{
            mode,
            grid_step,
            origin_x,
            origin_y,
            scale,
            maximum_error,
            collision_policy});
}

std::uint32_t d32_set_points_f64(
    std::uintptr_t handle,
    const double* coordinates,
    std::uint32_t point_count,
    std::uint32_t mode,
    double grid_step,
    double origin_x,
    double origin_y,
    double scale,
    double maximum_error,
    std::uint32_t collision_policy) noexcept {
    return set_float_points(
        context_from_handle(handle),
        coordinates,
        point_count,
        QuantizationArguments{
            mode,
            grid_step,
            origin_x,
            origin_y,
            scale,
            maximum_error,
            collision_policy});
}

std::uint32_t d32_set_constraints(
    std::uintptr_t handle,
    const std::uint32_t* endpoints,
    std::uint32_t constraint_count) noexcept {
    Context* context = context_from_handle(handle);
    return guarded(context, [&] {
        if (endpoints == nullptr && constraint_count != 0) {
            throw std::invalid_argument("constraint pointer is null");
        }
        std::vector<delaunay32::Constraint> constraints;
        constraints.reserve(constraint_count);
        for (std::uint32_t index = 0; index < constraint_count; ++index) {
            const std::size_t offset = static_cast<std::size_t>(index) * 2;
            constraints.push_back({endpoints[offset], endpoints[offset + 1]});
        }
        context->triangulator.set_constraints(std::move(constraints));
    });
}

std::uint32_t d32_set_polygons(
    std::uintptr_t handle,
    const std::uint32_t* indices,
    std::uint32_t index_count,
    const std::uint32_t* ring_offsets,
    std::uint32_t ring_count,
    const std::uint32_t* domain_offsets,
    std::uint32_t domain_count) noexcept {
    Context* context = context_from_handle(handle);
    return guarded(context, [&] {
        context->triangulator.set_polygons(copy_polygons(
            indices,
            index_count,
            ring_offsets,
            ring_count,
            domain_offsets,
            domain_count));
    });
}

std::uint32_t d32_sample_triangulate_f32(
    std::uintptr_t handle,
    const float* coordinates,
    std::uint32_t boundary_point_count,
    const std::uint32_t* indices,
    std::uint32_t index_count,
    const std::uint32_t* ring_offsets,
    std::uint32_t ring_count,
    const std::uint32_t* domain_offsets,
    std::uint32_t domain_count,
    std::uint32_t sampling_mode,
    std::uint32_t sampled_point_count,
    std::uint32_t seed,
    double jitter,
    std::uint32_t candidates_per_point,
    std::uint32_t attempts_per_point,
    std::uint32_t quantization_mode,
    double grid_step,
    double origin_x,
    double origin_y,
    double scale,
    double maximum_error,
    std::uint32_t collision_policy,
    std::uint32_t result_detail) noexcept {
    return sample_and_triangulate(
        context_from_handle(handle),
        coordinates,
        boundary_point_count,
        indices,
        index_count,
        ring_offsets,
        ring_count,
        domain_offsets,
        domain_count,
        SamplingArguments{
            sampling_mode,
            sampled_point_count,
            seed,
            jitter,
            candidates_per_point,
            attempts_per_point},
        QuantizationArguments{
            quantization_mode,
            grid_step,
            origin_x,
            origin_y,
            scale,
            maximum_error,
            collision_policy},
        result_detail);
}

std::uint32_t d32_sample_triangulate_f64(
    std::uintptr_t handle,
    const double* coordinates,
    std::uint32_t boundary_point_count,
    const std::uint32_t* indices,
    std::uint32_t index_count,
    const std::uint32_t* ring_offsets,
    std::uint32_t ring_count,
    const std::uint32_t* domain_offsets,
    std::uint32_t domain_count,
    std::uint32_t sampling_mode,
    std::uint32_t sampled_point_count,
    std::uint32_t seed,
    double jitter,
    std::uint32_t candidates_per_point,
    std::uint32_t attempts_per_point,
    std::uint32_t quantization_mode,
    double grid_step,
    double origin_x,
    double origin_y,
    double scale,
    double maximum_error,
    std::uint32_t collision_policy,
    std::uint32_t result_detail) noexcept {
    return sample_and_triangulate(
        context_from_handle(handle),
        coordinates,
        boundary_point_count,
        indices,
        index_count,
        ring_offsets,
        ring_count,
        domain_offsets,
        domain_count,
        SamplingArguments{
            sampling_mode,
            sampled_point_count,
            seed,
            jitter,
            candidates_per_point,
            attempts_per_point},
        QuantizationArguments{
            quantization_mode,
            grid_step,
            origin_x,
            origin_y,
            scale,
            maximum_error,
            collision_policy},
        result_detail);
}

std::uint32_t d32_triangulate(
    std::uintptr_t handle,
    std::uint32_t result_detail) noexcept {
    Context* context = context_from_handle(handle);
    return guarded(context, [&] {
        context->clear_pipeline_report();
        triangulate_context(*context, result_detail);
    });
}

std::uint32_t d32_quantize_f32(
    std::uintptr_t handle,
    const float* coordinates,
    std::uint32_t point_count,
    std::uint32_t mode,
    double grid_step,
    double origin_x,
    double origin_y,
    double scale,
    double maximum_error,
    std::uint32_t collision_policy) noexcept {
    return quantize_only(
        context_from_handle(handle),
        coordinates,
        point_count,
        QuantizationArguments{
            mode,
            grid_step,
            origin_x,
            origin_y,
            scale,
            maximum_error,
            collision_policy});
}

std::uint32_t d32_quantize_f64(
    std::uintptr_t handle,
    const double* coordinates,
    std::uint32_t point_count,
    std::uint32_t mode,
    double grid_step,
    double origin_x,
    double origin_y,
    double scale,
    double maximum_error,
    std::uint32_t collision_policy) noexcept {
    return quantize_only(
        context_from_handle(handle),
        coordinates,
        point_count,
        QuantizationArguments{
            mode,
            grid_step,
            origin_x,
            origin_y,
            scale,
            maximum_error,
            collision_policy});
}

std::uint32_t d32_error_code(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? static_cast<std::uint32_t>(ErrorCode::Internal)
        : static_cast<std::uint32_t>(context->error_code);
}

std::uintptr_t d32_error_message(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0
        : pointer_value(context->error_message.c_str());
}

std::uintptr_t d32_triangles_data(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0
        : pointer_value(context->result.triangles.data());
}

std::uint32_t d32_triangles_size(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0
        : static_cast<std::uint32_t>(context->result.triangles.size() * 3);
}

std::uintptr_t d32_halfedges_data(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr ? 0 : pointer_value(context->halfedges.data());
}

std::uint32_t d32_halfedges_size(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0
        : static_cast<std::uint32_t>(context->halfedges.size());
}

std::uintptr_t d32_hull_data(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr ? 0 : pointer_value(context->result.hull.data());
}

std::uint32_t d32_hull_size(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0
        : static_cast<std::uint32_t>(context->result.hull.size());
}

std::uintptr_t d32_representatives_data(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0
        : pointer_value(context->result.representatives.data());
}

std::uint32_t d32_representatives_size(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0
        : static_cast<std::uint32_t>(context->result.representatives.size());
}

std::uintptr_t d32_quantized_points_data(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0
        : pointer_value(context->quantization.points.data());
}

std::uint32_t d32_quantized_points_size(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0
        : static_cast<std::uint32_t>(context->quantization.points.size() * 2);
}

std::uint32_t d32_report_predicate_width(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    if (context == nullptr) {
        return 2;
    }
    switch (context->result.report.predicate_width) {
        case delaunay32::PredicateWidth::Int64:
            return 0;
        case delaunay32::PredicateWidth::Int128:
            return 1;
        case delaunay32::PredicateWidth::Unsupported:
            return 2;
    }
    return 2;
}

std::uint32_t d32_report_actual_thread_count(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0
        : static_cast<std::uint32_t>(
              context->result.report.actual_thread_count);
}

std::uint32_t d32_report_input_points(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0
        : static_cast<std::uint32_t>(context->result.report.input_points);
}

std::uint32_t d32_report_unique_points(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0
        : static_cast<std::uint32_t>(context->result.report.unique_points);
}

std::uint32_t d32_report_collapsed_points(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0
        : static_cast<std::uint32_t>(context->result.report.collapsed_points);
}

double d32_quantization_origin_x(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr ? 0.0 : context->quantization.report.origin_x;
}

double d32_quantization_origin_y(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr ? 0.0 : context->quantization.report.origin_y;
}

double d32_quantization_scale(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr ? 0.0 : context->quantization.report.scale;
}

double d32_quantization_grid_step(std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr ? 0.0 : context->quantization.report.grid_step;
}

double d32_quantization_max_coordinate_error(
    std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0.0
        : context->quantization.report.max_coordinate_error;
}

std::uint32_t d32_quantization_unique_points(
    std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0
        : static_cast<std::uint32_t>(
              context->quantization.report.unique_points);
}

std::uint32_t d32_quantization_collapsed_points(
    std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0
        : static_cast<std::uint32_t>(
              context->quantization.report.collapsed_points);
}

std::uint32_t d32_pipeline_boundary_points(
    std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr ? 0 : context->pipeline_report.boundary_points;
}

std::uint32_t d32_pipeline_generated_points(
    std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr ? 0 : context->pipeline_report.generated_points;
}

double d32_pipeline_sampling_milliseconds(
    std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0.0
        : context->pipeline_report.sampling_milliseconds;
}

double d32_pipeline_quantization_milliseconds(
    std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0.0
        : context->pipeline_report.quantization_milliseconds;
}

double d32_pipeline_triangulation_milliseconds(
    std::uintptr_t handle) noexcept {
    const Context* context = context_from_handle(handle);
    return context == nullptr
        ? 0.0
        : context->pipeline_report.triangulation_milliseconds;
}

}  // extern "C"

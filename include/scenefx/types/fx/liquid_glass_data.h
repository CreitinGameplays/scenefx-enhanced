#ifndef TYPES_FX_LIQUID_GLASS_DATA_H
#define TYPES_FX_LIQUID_GLASS_DATA_H

#include <stdbool.h>

enum liquid_glass_surface_type {
	LIQUID_GLASS_SURFACE_CONVEX_CIRCLE,
	LIQUID_GLASS_SURFACE_CONVEX_SQUIRCLE,
	LIQUID_GLASS_SURFACE_CONCAVE,
	LIQUID_GLASS_SURFACE_LIP,
};

struct liquid_glass_data {
	bool enabled;
	enum liquid_glass_surface_type surface_type;
	float bezel_width;
	float thickness;
	float refraction_index;
	float specular_opacity;
};

#endif

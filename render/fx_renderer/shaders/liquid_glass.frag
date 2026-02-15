#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_texcoord;
uniform sampler2D tex;

uniform int surface_type;
uniform float bezel_width;
uniform float thickness;
uniform float refraction_index;
uniform float specular_opacity;
uniform vec2 size;
uniform vec2 position;
uniform vec2 screen_size;

uniform vec2 clip_position;
uniform vec2 clip_size;
uniform float clip_radius_top_left;
uniform float clip_radius_top_right;
uniform float clip_radius_bottom_left;
uniform float clip_radius_bottom_right;

float corner_alpha(vec2 size, vec2 position, float radius_tl, float radius_tr, float radius_bl, float radius_br);

float rounded_rect_dist(vec2 p, vec2 size, float radius_tl, float radius_tr, float radius_bl, float radius_br) {
	// Determine which corner we are in
	float r;
	vec2 p_corner;
	if (p.x < size.x * 0.5) {
		if (p.y < size.y * 0.5) {
			r = radius_tl;
			p_corner = p - vec2(r);
		} else {
			r = radius_bl;
			p_corner = p - vec2(r, size.y - r);
		}
	} else {
		if (p.y < size.y * 0.5) {
			r = radius_tr;
			p_corner = p - vec2(size.x - r, r);
		} else {
			r = radius_br;
			p_corner = p - vec2(size.x - r, size.y - r);
		}
	}

	// Distance to a rectangle of size (size - 2*r)
	vec2 q = abs(p - size * 0.5) - (size * 0.5 - r);
	float dist_outside = length(max(q, 0.0)) - r;
	float dist_inside = min(max(q.x, q.y), 0.0);
	
	return dist_outside + dist_inside;
}

vec3 get_normal(vec2 p) {
	vec2 pixel_coord = p;

	// Detect screen edges (within 1px tolerance)
	bool is_left_edge = (position.x <= 1.0);
	bool is_right_edge = (position.x + size.x >= screen_size.x - 1.0);
	bool is_top_edge = (position.y <= 1.0);
	bool is_bottom_edge = (position.y + size.y >= screen_size.y - 1.0);

	// For the distance to be correctly calculated for the bezel, 
	// we should ideally exclude screen edges from the distance calculation.
	// But with rounded corners, it's more complex.
	// For now, let's calculate the distance to the rounded rect.
	
	float dist = -rounded_rect_dist(pixel_coord, size, 
		is_top_edge || is_left_edge ? 0.0 : clip_radius_top_left,
		is_top_edge || is_right_edge ? 0.0 : clip_radius_top_right,
		is_bottom_edge || is_left_edge ? 0.0 : clip_radius_bottom_left,
		is_bottom_edge || is_right_edge ? 0.0 : clip_radius_bottom_right);

	if (dist > bezel_width || dist < 0.0) {
		return vec3(0.0, 0.0, 1.0);
	}

	float x = dist / bezel_width;
	float z;
	float dz;

	if (surface_type == 0) { // Convex Circle
		z = sqrt(1.0 - pow(1.0 - x, 2.0));
		dz = (1.0 - x) / max(z, 0.001);
	} else if (surface_type == 1) { // Convex Squircle
		z = pow(1.0 - pow(1.0 - x, 4.0), 0.25);
		dz = pow(1.0 - x, 3.0) / max(pow(z, 3.0), 0.001);
	} else if (surface_type == 2) { // Concave
		z = 1.0 - sqrt(1.0 - pow(x, 2.0));
		dz = -x / max(sqrt(1.0 - pow(x, 2.0)), 0.001);
	} else { // Lip
		z = 0.5 + 0.5 * sin((x - 0.5) * 3.14159);
		dz = 0.5 * 3.14159 * cos((x - 0.5) * 3.14159);
	}

	// Approximate normal by gradient. 
	// For a simple bezel, the normal points towards the nearest edge.
	// We can approximate this by looking at the gradient of the rounded rect distance.
	// But a simpler way is to use the vector from the nearest point on the boundary.
	
	// For now, let's stick to a simpler approximation for the normal direction
	float dist_x = 1e10;
	if (!is_left_edge) dist_x = min(dist_x, pixel_coord.x);
	if (!is_right_edge) dist_x = min(dist_x, size.x - pixel_coord.x);

	float dist_y = 1e10;
	if (!is_top_edge) dist_y = min(dist_y, pixel_coord.y);
	if (!is_bottom_edge) dist_y = min(dist_y, size.y - pixel_coord.y);

	vec3 normal;
	if (dist_x < dist_y) {
		bool is_closer_to_left = (dist_x == pixel_coord.x);
		normal = vec3(is_closer_to_left ? dz : -dz, 0.0, 1.0);
	} else {
		bool is_closer_to_top = (dist_y == pixel_coord.y);
		normal = vec3(0.0, is_closer_to_top ? dz : -dz, 1.0);
	}
	return normalize(normal);
}

void main() {
	vec2 local_coord = gl_FragCoord.xy - position;
	vec3 normal = get_normal(local_coord);
	
		// Refraction: Snell-Descartes Law approximation
		// Displacement in pixels: normal.xy * thickness * (refraction_index - 1.0) * bezel_width
		// We normalize it by screen_size because v_texcoord is in [0, 1] screen space.
		vec2 displacement = normal.xy * thickness * (refraction_index - 1.0) * bezel_width / screen_size;
		vec4 color = texture2D(tex, v_texcoord + displacement);

		// Specular highlight: Light from top-left
		vec3 light_dir = normalize(vec3(-1.0, -1.0, 1.5));
		float spec = pow(max(dot(normal, light_dir), 0.0), 64.0);
		color.rgb += spec * specular_opacity;

		// Clipping
	
		float clip_corner_alpha = corner_alpha(
			clip_size - 1.0,
			clip_position + 0.5,
			clip_radius_top_left,
			clip_radius_top_right,
			clip_radius_bottom_left,
			clip_radius_bottom_right
		);

		gl_FragColor = color; // if you put color * clip_corner_alpha, every transparency will be black!!! Don't put it here.
	
	}

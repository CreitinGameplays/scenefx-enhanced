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

float get_dist_and_grad(vec2 p, vec2 size, float radius_tl, float radius_tr, float radius_bl, float radius_br, out vec2 grad) {
	// Determine which corner we are in to select the radius
	float r;
	if (p.x < size.x * 0.5) {
		if (p.y < size.y * 0.5) {
			r = radius_tl;
		} else {
			r = radius_bl;
		}
	} else {
		if (p.y < size.y * 0.5) {
			r = radius_tr;
		} else {
			r = radius_br;
		}
	}

	// Distance to a rectangle of size (size - 2*r)
	vec2 center = size * 0.5;
	vec2 p_centered = p - center;
	vec2 q = abs(p_centered) - (center - vec2(r));
	
	float dist_outside = length(max(q, 0.0)) - r;
	float dist_inside = min(max(q.x, q.y), 0.0);
	
	// Gradient calculation (direction pointing OUTWARDS from the shape)
	if (max(q.x, q.y) > 0.0) {
		// Outside the inner box (corner or outside)
		grad = normalize(max(q, 0.0));
	} else {
		// Inside the inner box
		if (q.x > q.y) grad = vec2(1.0, 0.0);
		else grad = vec2(0.0, 1.0);
	}
	
	// Restore signs
	vec2 sign_p = vec2(p_centered.x >= 0.0 ? 1.0 : -1.0, p_centered.y >= 0.0 ? 1.0 : -1.0);
	grad *= sign_p;

	return dist_outside + dist_inside;
}

vec3 get_normal(vec2 p) {
	vec2 pixel_coord = p;

	// Detect screen edges (within 1px tolerance)
	bool is_left_edge = (position.x <= 1.0);
	bool is_right_edge = (position.x + size.x >= screen_size.x - 1.0);
	bool is_top_edge = (position.y <= 1.0);
	bool is_bottom_edge = (position.y + size.y >= screen_size.y - 1.0);

	vec2 grad;
	float dist = -get_dist_and_grad(pixel_coord, size, 
		is_top_edge || is_left_edge ? 0.0 : clip_radius_top_left,
		is_top_edge || is_right_edge ? 0.0 : clip_radius_top_right,
		is_bottom_edge || is_left_edge ? 0.0 : clip_radius_bottom_left,
		is_bottom_edge || is_right_edge ? 0.0 : clip_radius_bottom_right,
		grad);

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

	// Calculate the normal based on the surface slope (dz) and the edge gradient (grad).
	// 'grad' points outwards from the window, and 'dz' is the slope along the
	// inward direction, so 'grad * dz' provides the horizontal tilt of the normal.
	return normalize(vec3(grad * dz, 1.0));
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

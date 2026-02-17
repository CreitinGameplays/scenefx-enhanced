#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

#define pi_2 1.57079632679

varying vec2 v_texcoord;
uniform sampler2D tex;

uniform int surface_type;
uniform float bezel_width;
uniform float thickness;
uniform float refraction_index;
uniform bool specular_enabled;
uniform float specular_opacity;
uniform float specular_angle;
uniform float brightness_boost;
uniform float saturation_boost;
uniform float noise_intensity;
uniform float chromatic_aberration;

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
	vec2 center = size * 0.5;
	vec2 p_centered = p - center;

	// Separate sk factors:
	// sk_geo: controls the sharpness of the shape's outline/clipping.
	//         Keep it high (32.0) to preserve squared corners.
	float sk_geo = 32.0;

	// sk_grad: controls the smoothness of the surface normal/gradient.
	//          Lowering this (e.g. to 6.0) rounds the internal bevel corners,
	//          softening the "X" miter joint artifact.
	float sk_grad = 6.0;

	// Determine which corner we are in to select the radius
	float r;
	if (p_centered.x < 0.0) {
		if (p_centered.y < 0.0) r = radius_tl;
		else r = radius_bl;
	} else {
		if (p_centered.y < 0.0) r = radius_tr;
		else r = radius_br;
	}

	// --- GEOMETRY / DISTANCE (Sharp) ---
	vec2 abs_xk_geo = abs(p_centered * sk_geo);
	vec2 exp_m2abs_geo = exp(-2.0 * abs_xk_geo);
	vec2 sabs_p_geo = (abs_xk_geo + log(1.0 + exp_m2abs_geo)) / sk_geo;
	vec2 q_geo = sabs_p_geo - (center - vec2(r));

	float m_geo = max(q_geo.x, q_geo.y);
	float smax_q_geo = m_geo + log(exp((q_geo.x - m_geo) * sk_geo) + exp((q_geo.y - m_geo) * sk_geo)) / sk_geo;
	float d = length(max(q_geo, 0.0)) + min(smax_q_geo - log(2.0) / sk_geo, 0.0) - r;

	// --- GRADIENT / NORMAL (Smooth) ---
	vec2 abs_xk_grad = abs(p_centered * sk_grad);
	vec2 exp_m2abs_grad = exp(-2.0 * abs_xk_grad);
	vec2 sabs_p_grad = (abs_xk_grad + log(1.0 + exp_m2abs_grad)) / sk_grad;
	vec2 q_grad = sabs_p_grad - (center - vec2(r));

	float m_grad = max(q_grad.x, q_grad.y);

	// Calculate smooth edge gradient
	vec2 g_edge = exp((q_grad - vec2(m_grad)) * sk_grad);
	g_edge /= (g_edge.x + g_edge.y);
	g_edge = normalize(g_edge); // Normalize to keep magnitude 1.0

	vec2 g_corner = normalize(max(q_grad, 0.001));
	// smoothstep range needs to scale with sk_grad
	float corner_weight = smoothstep(0.0, 2.0 / sk_grad, min(q_grad.x, q_grad.y));
	grad = mix(g_edge, g_corner, corner_weight);

	// Apply centering derivative and normalize to maintain consistent tilt magnitude.
	// Use a softer sk for the derivative to avoid aliasing at the center axis.
	float sk_smooth = 4.0;
	vec2 abs_xk_smooth = abs(p_centered * sk_smooth);
	vec2 exp_m2abs_smooth = exp(-2.0 * abs_xk_smooth);
	vec2 dsabs = sign(p_centered) * (1.0 - exp_m2abs_smooth) / (1.0 + exp_m2abs_smooth);
	grad = normalize(grad) * dsabs;

	// Small constant offset to compensate for the smooth-max bias.
	return d;
}

void get_surface_z_dz(float x, out float z, out float dz) {

	if (surface_type == 0) { // Convex Circle
		z = sin(x * pi_2);
		dz = pi_2 * cos(x * pi_2);
	} else if (surface_type == 1) { // Convex Squircle
		// A smooth polynomial that matches the slope of Convex Circle at the edge
		// but stays perfectly flat (dz=0) at the interior (x=1).
		z = 1.5 * x - 0.5 * x * x * x;
		dz = 1.5 - 1.5 * x * x;
	} else if (surface_type == 2) { // Concave
		z = 1.0 - sqrt(1.0 - pow(1.0 - x, 2.0));
		dz = -(1.0 - x) / max(sqrt(1.0 - pow(1.0 - x, 2.0)), 0.01);
	} else { // Lip
		// A perfectly smooth s-curve transition from 0 to 1.
		// Unlike Convex Circle/Squircle, it is flat at both the edge and the interior.
		z = 0.5 - 0.5 * cos(x * 3.14159265359);
		dz = 0.5 * 3.14159265359 * sin(x * 3.14159265359);
	}
}

// Pseudo-random noise function
float rand(vec2 co) {
	return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

// Saturation adjustment
vec3 adjust_saturation(vec3 rgb, float adjustment) {
	const vec3 luminance_coeff = vec3(0.2125, 0.7154, 0.0721);
	vec3 intensity = vec3(dot(rgb, luminance_coeff));
	return mix(intensity, rgb, adjustment);
}

void main() {
    vec2 local_coord = gl_FragCoord.xy - position;

	// Detect screen edges (within 1px tolerance)
	bool is_left_edge = (position.x <= 1.0);
	bool is_right_edge = (position.x + size.x >= screen_size.x - 1.0);
	bool is_top_edge = (position.y <= 1.0);
	bool is_bottom_edge = (position.y + size.y >= screen_size.y - 1.0);

	vec2 grad;
	float dist = -get_dist_and_grad(local_coord, size,
		is_top_edge || is_left_edge ? 0.0 : clip_radius_top_left,
		is_top_edge || is_right_edge ? 0.0 : clip_radius_top_right,
		is_bottom_edge || is_left_edge ? 0.0 : clip_radius_bottom_left,
		is_bottom_edge || is_right_edge ? 0.0 : clip_radius_bottom_right,
		grad);

	if (dist < 0.0) {
		discard;
	}

	vec3 final_normal = vec3(0.0, 0.0, 1.0);
	// Convex shapes (0, 1) and Lip (3) are thick in the center (z=1), others (2) are thin (z=0)
	float surface_z = (surface_type == 0 || surface_type == 1 || surface_type == 3) ? 1.0 : 0.0;

	// Fix for visual bugs on tiny windows (horizontal line, diagonal markings)
	float effective_bezel_width = min(bezel_width, min(size.x, size.y) * 0.5);

	if (dist <= effective_bezel_width) {
		float x = clamp(dist / effective_bezel_width, 0.0, 1.0);
		float z, dz;
		get_surface_z_dz(x, z, dz);

		surface_z = z;

		// Normal tilts outwards by the slope dz
		float tilt = dz * thickness;
		final_normal = normalize(vec3(grad * tilt, 1.0));
	}

	// Height for refraction
	float h = surface_z * thickness * effective_bezel_width * 0.5;

	vec3 I = vec3(0.0, 0.0, -1.0);

	// Refraction with optional chromatic aberration
	vec4 color;
	if (chromatic_aberration > 0.0) {
		float ca = chromatic_aberration / screen_size.x;

		vec3 R_r = refract(I, final_normal, 1.0 / (refraction_index + ca));
		vec3 R_g = refract(I, final_normal, 1.0 / refraction_index);
		vec3 R_b = refract(I, final_normal, 1.0 / (refraction_index - ca));

		float k_r = -h / max(abs(R_r.z), 0.0001);
		float k_g = -h / max(abs(R_g.z), 0.0001);
		float k_b = -h / max(abs(R_b.z), 0.0001);

		// Clamp offset to bezel_width to ensure we stay within the captured background margin
		vec2 offset_r = clamp(R_r.xy * k_r, -vec2(bezel_width), vec2(bezel_width));
		vec2 offset_g = clamp(R_g.xy * k_g, -vec2(bezel_width), vec2(bezel_width));
		vec2 offset_b = clamp(R_b.xy * k_b, -vec2(bezel_width), vec2(bezel_width));

		color.r = texture2D(tex, v_texcoord + offset_r / screen_size).r;
		color.g = texture2D(tex, v_texcoord + offset_g / screen_size).g;
		color.b = texture2D(tex, v_texcoord + offset_b / screen_size).b;
		color.a = 1.0;
	} else {
		vec3 R = refract(I, final_normal, 1.0 / refraction_index);
		float k = -h / max(abs(R.z), 0.0001);

		// Clamp offset to bezel_width to ensure we stay within the captured background margin
		vec2 offset = clamp(R.xy * k, -vec2(bezel_width), vec2(bezel_width));

		color = texture2D(tex, v_texcoord + offset / screen_size);
	}

	// Brightness and saturation boosts
	color.rgb *= brightness_boost;
	color.rgb = adjust_saturation(color.rgb, saturation_boost);

	// Specular highlights
	if (specular_enabled && specular_opacity > 0.0) {
		float angle_rad = radians(specular_angle);
		// Light source direction: tilted 45 degrees from the Z-axis towards the specified angle
		vec3 light_dir = normalize(vec3(cos(angle_rad), sin(angle_rad), 1.0));

		float nl = max(dot(final_normal, light_dir), 0.0);
		// Sharp highlight for a glassy look
		float specular = pow(nl, 32.0);

		color.rgb += specular * specular_opacity;
	}

	// Surface Noise / Grain
	if (noise_intensity > 0.0) {
		float n = rand(gl_FragCoord.xy) * 2.0 - 1.0;
		color.rgb += n * noise_intensity;
	}

	gl_FragColor = color;
}
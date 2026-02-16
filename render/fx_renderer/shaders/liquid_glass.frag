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

	// Determine which corner we are in to select the radius
	float r;
	if (p_centered.x < 0.0) {
		if (p_centered.y < 0.0) r = radius_tl;
		else r = radius_bl;
	} else {
		if (p_centered.y < 0.0) r = radius_tr;
		else r = radius_br;
	}

	// sk = 12.0 / bezel_width provides a tight transition that matches the intended shape while remaining smooth.
	float sk = 12.0 / max(bezel_width, 1.0);

	// We use a smooth-absolute value and smooth-max (log-sum-exp) for the entire shape to ensure C-infinity continuity.
	// This eliminates polygonal artifacts and ridges by providing a perfectly smooth distance field.
	vec2 abs_xk = abs(p_centered * sk);
	vec2 exp_m2abs = exp(-2.0 * abs_xk);
	vec2 sabs_p = (abs_xk + log(1.0 + exp_m2abs)) / sk;

	vec2 q = sabs_p - (center - vec2(r));

	float m = max(q.x, q.y);
	float smax_q = m + log(exp((q.x - m) * sk) + exp((q.y - m) * sk)) / sk;

	// The gradient of the log-sum-exp is perfectly continuous.
	grad = exp((q - vec2(m)) * sk);
	grad /= (grad.x + grad.y);

	// Multiply by the derivative of sabs (tanh) and normalize the result to ensure the gradient
	// is smooth at the center while maintaining consistent tilt magnitude elsewhere.
	vec2 dsabs = sign(p_centered) * (1.0 - exp_m2abs) / (1.0 + exp_m2abs);
	grad = normalize(grad) * dsabs;

	// Offset by r and the smax error at the diagonal (log(2)/sk) to keep the distance field consistent.
	return smax_q - r - log(2.0) / sk;
}

void get_surface_z_dz(float x, out float z, out float dz) {

	if (surface_type == 0) { // Convex Circle
		z = sin(x * pi_2);
		dz = pi_2 * cos(x * pi_2);
	} else if (surface_type == 1) { // Convex Squircle
		z = pow(1.0 - pow(1.0 - x, 4.0), 0.25);
		// Stabilize the derivative near x=0 where z is near 0.
		// A slightly larger epsilon here helps soften the transition at the very edge.
		dz = pow(1.0 - x, 3.0) / max(pow(z, 3.0), 0.25);
	} else if (surface_type == 2) { // Concave
		z = 1.0 - sqrt(1.0 - pow(1.0 - x, 2.0));
		dz = -(1.0 - x) / max(sqrt(1.0 - pow(1.0 - x, 2.0)), 0.02);
	} else { // Lip
		float z_conv = sqrt(1.0 - pow(1.0 - x, 2.0));
		float z_conc = 1.0 - z_conv;
		float t = x * x * x * (x * (x * 6.0 - 15.0) + 10.0); // smootherstep
		z = mix(z_conv, z_conc, t);

		float dz_conv = (1.0 - x) / max(z_conv, 0.02);
		float dz_conc = -dz_conv;
		float dt = 30.0 * x * x * (x * (x - 2.0) + 1.0);
		dz = dz_conv * (1.0 - t) + dz_conc * t + (z_conc - z_conv) * dt;
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


	vec3 final_normal = vec3(0.0, 0.0, 1.0);
	float surface_z = 1.0;

	if (dist >= 0.0 && dist <= bezel_width) {
		float x = dist / bezel_width;
		float z, dz;
		get_surface_z_dz(x, z, dz);

		surface_z = z;

		// Normal tilts outwards by the slope dz
		float tilt = dz * thickness;
		final_normal = normalize(vec3(grad * tilt, 1.0));
	}

	// Height for refraction
	float h = surface_z * thickness * bezel_width * 0.5;

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

		color.r = texture2D(tex, v_texcoord + (R_r.xy * k_r) / screen_size).r;
		color.g = texture2D(tex, v_texcoord + (R_g.xy * k_g) / screen_size).g;
		color.b = texture2D(tex, v_texcoord + (R_b.xy * k_b) / screen_size).b;
		color.a = 1.0;
	} else {
		vec3 R = refract(I, final_normal, 1.0 / refraction_index);
		float k = -h / max(abs(R.z), 0.0001);
		color = texture2D(tex, v_texcoord + (R.xy * k) / screen_size);
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
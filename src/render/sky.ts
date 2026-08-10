/**
 * The sky, and the light that comes off it.
 *
 * A racing game is lit almost entirely by two things: a sun, and the enormous
 * blue dome that bounces light back into everything the sun does not reach. The
 * old rig had a `HemisphereLight` and a flat clear-colour background, which is
 * the same two things — but with the dome invisible. That is most of why the
 * build read as a prototype: with nothing on the horizon, the circuit ended in
 * mid-air, and with no gradient overhead there was nothing for the bodywork to
 * reflect, so carbon and paint came out the same matte grey.
 *
 * The dome here is a single inverted sphere with a gradient shader. It is not
 * physically-based sky scattering — that is a lot of maths to arrive at a
 * gradient nobody looks directly at — but it gets the three things right that
 * matter: the horizon is pale and warm, the zenith is deep, and the sun has a
 * bloom around it that tells you where the light is coming from. Fog is set to
 * the horizon colour so the circuit dissolves into the sky rather than being
 * clipped out of it.
 *
 * Time of day is mid-afternoon in early September at Monza: the sun is high
 * enough for short hard shadows, low enough that the bodywork catches a rim of
 * light down one side. CLAUDE.md asks for "a real time of day at a real
 * circuit", and this is that choice made explicit rather than eyeballed per
 * material.
 */

import * as THREE from 'three'

/**
 * Where the sun is, and what colour it is when it gets here.
 *
 * Elevation and azimuth rather than a position vector, because those are the
 * numbers that mean something: change the elevation and you change the time of
 * day, and every shadow in the scene moves correctly with it.
 */
export const SUN = {
  /** Degrees above the horizon. */
  elevation: 38,
  /** Degrees, clockwise from north. Puts the light over the driver's left. */
  azimuth: 125,
  /** Direct sunlight, in the renderer's physical units. */
  intensity: 3.4,
  /** ~5200K sunlight after atmospheric warming at this elevation. */
  colour: 0xfff4e2,
  /** Bounce from the sky dome and the ground. Never zero, or shadows go black. */
  ambientIntensity: 0.9,
} as const

export const SKY = {
  zenith: 0x2a5c9c,
  horizon: 0xbcd2e6,
  /** Ground half of the dome, seen past the end of the terrain. */
  haze: 0x9fb0bd,
  sunGlow: 0xfff6e0,
} as const

/** Unit vector pointing from the origin toward the sun. */
export function sunDirection(): THREE.Vector3 {
  const elevation = THREE.MathUtils.degToRad(SUN.elevation)
  const azimuth = THREE.MathUtils.degToRad(SUN.azimuth)
  return new THREE.Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  ).normalize()
}

const VERTEX = /* glsl */ `
  varying vec3 vDirection;

  void main() {
    // World-space direction from the camera to this vertex. The dome is drawn
    // with depth writing off and follows the camera, so this is all the shader
    // needs — no position, no scale.
    vDirection = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAGMENT = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 haze;
  uniform vec3 sunGlow;
  uniform vec3 sunDirection;

  varying vec3 vDirection;

  void main() {
    vec3 direction = normalize(vDirection);

    // Above the horizon: pale to deep, biased so most of the visible sky at a
    // chase-camera pitch is the mid tone rather than the zenith.
    float height = clamp(direction.y, 0.0, 1.0);
    vec3 sky = mix(horizon, zenith, pow(height, 0.42));

    // Below it: the haze the terrain fades into. Short ramp, because anything
    // slower reads as a second sky underneath the first.
    float below = clamp(-direction.y * 12.0, 0.0, 1.0);
    sky = mix(sky, haze, below);

    // Two lobes: a tight disc for the sun itself and a wide one for the
    // scattering around it. Both additive, both clamped by height so the glow
    // does not leak under the horizon.
    float toSun = max(dot(direction, sunDirection), 0.0);
    float bloom = pow(toSun, 8.0) * 0.30 + pow(toSun, 900.0) * 0.9;
    sky += sunGlow * bloom * (1.0 - below);

    gl_FragColor = vec4(sky, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/**
 * The dome.
 *
 * Radius is arbitrary — it renders with depth test off and is repositioned onto
 * the camera every frame, so it can never clip the far plane and never occludes
 * anything. That is why it does not need to be sized against the circuit.
 */
export function buildSky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: new THREE.Color(SKY.zenith) },
      horizon: { value: new THREE.Color(SKY.horizon) },
      haze: { value: new THREE.Color(SKY.haze) },
      sunGlow: { value: new THREE.Color(SKY.sunGlow) },
      sunDirection: { value: sunDirection() },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: true,
  })

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material)
  // First thing drawn, and it never occludes: everything else paints over it.
  mesh.renderOrder = -1
  mesh.frustumCulled = false
  mesh.name = 'sky'
  return mesh
}

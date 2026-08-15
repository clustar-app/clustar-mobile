// Design tokens mirrored from clustar-app.html so the mobile client feels
// like the mockup from screen one. Kept as plain objects (not a UI library)
// so we can tune quickly without a theming framework.

export const colors = {
  bg: "#09090B",
  s1: "#131316",
  s2: "#1A1A1E",
  s3: "#242428",
  s4: "#2E2E33",
  t1: "#EAEAEB",
  t2: "#87878F",
  t3: "#55555C",
  t4: "#3A3A40",
  accent: "#E8A43A",
  accentDim: "#C4892D",
  accentBg: "rgba(232,164,58,0.10)",
  anon: "#5EC4A8",
  anonBg: "rgba(94,196,168,0.10)",
  danger: "#E85C5C",
  dangerBg: "rgba(232,92,92,0.10)",
  success: "#5CBF7A",
  successBg: "rgba(92,191,122,0.10)",
  border: "rgba(255,255,255,0.06)",
  borderS: "rgba(255,255,255,0.10)",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
};

export const font = {
  // System font by default — we don't ship Space Grotesk yet because bundling
  // fonts requires expo-font asset registration. Add later if the look demands.
  regular: undefined as string | undefined,
};

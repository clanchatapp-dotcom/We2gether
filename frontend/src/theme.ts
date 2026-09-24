// Design tokens for 2gether — Hand-Drawn / Journal, soft rose palette.
// Keys match the "color" block of /app/design_guidelines.json. Light + dark.
//
// Use the pair pattern: a background key and its `on` partner for text/icons.
// Build sheets with makeStyles((colors) => ({...})); read useTheme().colors for
// non-style color props. Never write color literals in components.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FDFBF7",
  onSurface: "#2C2623",
  surfaceSecondary: "#F5F0E6",
  onSurfaceSecondary: "#3D3531",
  surfaceTertiary: "#EFE8DB",
  onSurfaceTertiary: "#4F4540",
  surfaceInverse: "#2C2623",
  onSurfaceInverse: "#FDFBF7",
  muted: "#8E8078",

  brand: "#E29596",
  onBrand: "#4A2324",
  brandPrimary: "#D17B7D",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#EAB8B9",
  onBrandSecondary: "#4A2324",
  brandTertiary: "#F4DADA",
  onBrandTertiary: "#6B3335",

  success: "#879C81",
  onSuccess: "#FFFFFF",
  warning: "#E0AA77",
  onWarning: "#FFFFFF",
  error: "#C27367",
  onError: "#FFFFFF",
  info: "#8CA8B5",
  onInfo: "#FFFFFF",

  border: "#E8DFD3",
  borderStrong: "#D6C5B3",
  divider: "#E8DFD3",
};

export type ThemeColors = typeof light;

const dark: ThemeColors = {
  surface: "#1F1A18",
  onSurface: "#F4EFEA",
  surfaceSecondary: "#2A2320",
  onSurfaceSecondary: "#E8DFD3",
  surfaceTertiary: "#382E2A",
  onSurfaceTertiary: "#D6C5B3",
  surfaceInverse: "#FDFBF7",
  onSurfaceInverse: "#1F1A18",
  muted: "#A19288",

  brand: "#C47476",
  onBrand: "#FFFFFF",
  brandPrimary: "#D17B7D",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#B05C5E",
  onBrandSecondary: "#F4DADA",
  brandTertiary: "#4A2324",
  onBrandTertiary: "#EAB8B9",

  success: "#879C81",
  onSuccess: "#FFFFFF",
  warning: "#E0AA77",
  onWarning: "#FFFFFF",
  error: "#C27367",
  onError: "#FFFFFF",
  info: "#8CA8B5",
  onInfo: "#FFFFFF",

  border: "#382E2A",
  borderStrong: "#4F4540",
  divider: "#382E2A",
};

export const fonts = {
  display: "Fraunces",
  displayBold: "Fraunces",
  text: "Nunito",
  accent: "Caveat",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
};

export const radius = {
  sm: 8,
  md: 16,
  lg: 24,
  pill: 999,
};

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light, dark };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

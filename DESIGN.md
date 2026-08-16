# Design System

## Intent

A one-handed camera instrument used above a family dining table in mixed evening light. The live image is the product surface; controls are dark to reduce glare and keep attention on the dominoes.

## Theme

Restrained dark product UI. No gradients, glass effects, decorative cards, or background illustration. The camera occupies the full viewport and a solid control dock sits in the lower thumb zone.

## Color

All production colours use OKLCH.

- Background: `oklch(0.08 0 0)`
- Surface: `oklch(0.14 0 0)`
- Raised surface: `oklch(0.20 0.008 145)`
- Ink: `oklch(0.98 0 0)`
- Muted ink: `oklch(0.75 0.01 145)`
- Primary: `oklch(0.65 0.15 145)`
- Primary active: `oklch(0.57 0.15 145)`
- Focus: `oklch(0.82 0.13 145)`
- Error: `oklch(0.68 0.18 28)`

Primary green is used for detection rings, readiness, focus, and the main action only.

## Typography

Use the native system sans stack for instant loading and a familiar phone-app feel. Fixed product scale:

- Score: `5rem`, bold, tabular numerals
- Heading: `1.25rem`, semibold
- Body/action: `1rem`, medium or semibold
- Secondary: `0.875rem`, medium
- Caption: `0.75rem`, semibold

## Spacing

Four-point scale: 4, 8, 12, 16, 24, 32, and 48px. Controls cluster tightly; camera and score groups have generous separation. Safe-area insets are additive.

## Components

- Top bar: compact title and an on-device privacy status.
- Camera stage: edge-to-edge video, detection canvas, and a quiet aiming frame.
- Score dock: solid near-black surface with score, stability copy, primary action, and two secondary icon controls.
- Frozen controls: decrement, confirmed score, increment, and scan-again action.
- Camera gate/error: short actionable copy with a direct camera or photo action.

Buttons use an 8-12px radius, never card-scale rounding. Icon controls are circular because their hit targets represent single compact actions.

## Motion

Use 180-220ms ease-out transitions for state changes. Detection rings may gently settle when a score stabilises. Reduced-motion mode removes transforms and pulsing.

## Responsive Behaviour

Portrait phone is primary. Landscape phone puts the score dock on the right. Tablet and desktop constrain the camera instrument to a phone-like maximum width while keeping photo upload available for testing and fallback.

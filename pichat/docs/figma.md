# PiChat Design System

PiChat uses a dark-first aesthetic designed for OLED displays while maintaining accessibility and high contrast.

## Foundations

- **Typography**: Inter font family with five roles – Display (28/36), Title (20/28), Body (16/24), Caption (14/20), Micro (12/16). Dynamic type scaling is supported.
- **Color Palette**: Deep charcoal backgrounds (`#0B0C0F`, `#12141A`) with lavender brand accents (`#7C5CFF`). Success/warning/error states follow traffic-light conventions while preserving contrast.
- **Spacing**: 4px baseline grid with increments up to 32px for layout rhythm.
- **Elevation**: Single soft shadow for cards and dialogs `0 4 12 rgba(0,0,0,0.2)`.
- **Radii**: Rounded corners of 8–28px establish a cozy, modern feel.
- **Animation**: Spring-like cubic bezier `(0.2, 0.8, 0.2, 1)` with durations from 150–400 ms.

Full token export is available in [`design/figma-tokens.json`](../design/figma-tokens.json).

## Components

| Component | Variants | Notes |
|-----------|----------|-------|
| **Button** | `primary`, `secondary`, `ghost`; sizes `md`, `sm`; loading + disabled states | Primary uses brand background with inverse text. Secondary uses surface fill with muted border. Ghost is text-only. |
| **Input** | default, `password`, `textarea` | Includes left/right accessory icons, floating label, error helper text. |
| **AppBar** | default, `transparent` | Title centered, optional left/right actions. |
| **ListItem** | `default`, `navigable`, `destructive` | Used for settings and conversation lists. Supports leading avatar/icon and trailing metadata. |
| **ChatBubble** | `me`, `peer`, `system` | Rounded corners adapt to message grouping. Supports reactions row and status ticks. |
| **Toast** | `success`, `warning`, `error`, `info` | Slide-in from top with auto-dismiss and accessible focus trap. |
| **Dialog** | `alert`, `confirmation`, `sheet` | Buttons follow primary/secondary ordering. |
| **Switch** | default | Toggle with accessible hit target. |
| **Avatar** | `initials`, `image`, `lock` | Displays fallback color hashed from contact fingerprint. |
| **QRCard** | `share`, `scan-result` | Card containing QR code, fingerprint, and instructions. |

## Screen Blueprints

1. **Onboarding**: Fullscreen gradient background with fingerprint preview card, call-to-action button, and progress indicator.
2. **Home**: AppBar with search input, conversation list with unread chips, floating new chat button.
3. **Chat**: Sticky date dividers, bubble alignment, composer with attach/send icons, ephemeral toast for verification reminders.
4. **Add Contact**: Tab bar for “Scan QR”, “My QR”, “Paste Link”. Each tab uses QRCard components; includes fingerprint comparison step.
5. **Settings**: Sections for Appearance, Privacy & Security, Recovery, and Advanced (debug logs). Each section uses ListItems with icons and toggles.
6. **Recovery**: Form for importing Recovery Kit, passphrase entry, status messaging.

## Accessibility

- Minimum 4.5:1 contrast on text/background combinations.
- Buttons and interactive elements maintain a 44px touch target.
- Supports screen reader labels for icons, attachments, and message status.
- Motion preferences respected by reducing animation durations or disabling non-essential transitions.

## Iconography

Lucide icons (`send`, `qr`, `scan`, `lock`, `attach`, `shield`) are used consistently with a 24px bounding box and 2px stroke.

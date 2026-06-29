# Accessibility & Readability

## Readability

### Chinese Text

- Minimum body text size: `text-sm` (14px)
- Line height: default (1.5) for body text
- Ensure CJK characters render correctly with the system font stack
- No condensed or narrow font variants

### Contrast

| Element | Minimum contrast ratio |
|---------|----------------------|
| Body text | 4.5:1 |
| Large text (≥18px bold) | 3:1 |
| UI components / graphical objects | 3:1 |
| Disabled text | No requirement, but should be distinguishable |

### Color Usage

- Color must not be the **only** means of conveying information
- Pass/fail uses ✅/❌ icons + green/red colors
- Status badges use text labels + colors
- Error messages use red text + icon, not color alone

## Accessibility

### Focus Management

- All interactive elements must be keyboard-reachable via `Tab`
- Focus ring: `ring-2 ring-ring ring-offset-2`
- Dialog opens: focus moves to first focusable element inside
- Dialog closes: focus returns to trigger element
- Focus trap active inside open dialogs

### Forms

- Every input has an associated `<label>` with `htmlFor`
- Error messages: `role="alert"` + `aria-live="polite"`
- Required fields: visually marked + `aria-required="true"`
- Validation errors: displayed below the field, not in alerts

### States

| State | Visual | ARIA |
|-------|--------|------|
| Loading | Skeleton placeholders | `aria-busy="true"` |
| Empty | EmptyState component | `role="status"` |
| Error | ErrorState component | `role="alert"` |
| Disabled button | `opacity-50` | `aria-disabled="true"` |
| Toggle active | Visual indicator | `aria-pressed="true/false"` |

### Keyboard Navigation (Admin)

- `Tab`: navigate all interactive elements
- `Enter`: activate buttons/links
- `Escape`: close dialogs/dropdowns
- Dialogs: focus trap active

### Keyboard Shortcuts (Exam Answer Page)

| Key | Action |
|-----|--------|
| `←` / `→` | Previous / next question |
| `Space` | Flag current question for review |
| `1`-`4` | Select answer choice A-D (single choice) |
| `Escape` | Close dialog |
| `Enter` | Confirm dialog action |

### Animation

- Respect `prefers-reduced-motion`
- No auto-playing animations
- Transitions should be brief (150-200ms) and functional, not decorative

## Testing

Manual checks for each page:

- [ ] Tab through all interactive elements — focus order is logical
- [ ] Operate all actions with keyboard only
- [ ] Verify Chinese text readability at default zoom
- [ ] Check contrast with browser dev tools
- [ ] Verify empty/loading/error states are announced

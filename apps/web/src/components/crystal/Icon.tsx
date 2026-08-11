import { ICONS, type IconName } from '../../generated/icons';
import { cx } from '../../lib/cx';

export type { IconName };

export type IconSize = 'sm' | 'md' | 'lg' | 'xl';

interface IconProps {
  name: IconName;
  /** sm 15 · md 20 · lg 24 · xl 30, per design system section 06. */
  size?: IconSize;
  className?: string;
  /**
   * Icons are decoration by default and are hidden from assistive technology.
   * Pass a title only when the icon is the *only* carrier of meaning — which,
   * per rule 12, should be nowhere in this product.
   */
  title?: string;
}

const SIZE_CLASS: Record<IconSize, string> = { sm: 'sm', md: '', lg: 'lg', xl: 'xl' };

/**
 * The one icon set.
 *
 * Every glyph is generated from the design system's sprite, so the app cannot
 * introduce a second one. Icons take the colour of the text around them
 * (rule 3) — nothing here sets a colour, ever.
 */
export function Icon({ name, size = 'md', className, title }: IconProps): React.ReactElement {
  const icon = ICONS[name];
  return (
    <svg
      className={cx('ic', SIZE_CLASS[size], className)}
      viewBox={icon.viewBox}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      // Source is our own build artefact, generated from a local file.
      dangerouslySetInnerHTML={{ __html: icon.d }}
    />
  );
}

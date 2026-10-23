import type { PlayerView } from '#desktop/contracts';

type LegendAppearance = PlayerView['maps'][number]['legend'][number]['appearance'];
const ns = 'http://www.w3.org/2000/svg';

/** Mirror the saved map renderer's symbols without inserting user-authored HTML. */
export function markerBadge(appearance: LegendAppearance, className = '') {
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '-16 -16 32 32');
  svg.setAttribute('width', '28');
  svg.setAttribute('height', '28');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('map-marker');
  if (className) svg.classList.add(className);
  const color = 'color' in appearance ? appearance.color : '#fef3c7';
  const shape = document.createElementNS(
    ns,
    appearance.shape === 'circle' ? 'circle' : appearance.shape === 'square' ? 'rect' : 'polygon',
  );
  if (appearance.shape === 'circle') {
    shape.setAttribute('cx', '0');
    shape.setAttribute('cy', '0');
    shape.setAttribute('r', '12');
  } else if (appearance.shape === 'triangle') {
    shape.setAttribute('points', '0,-12 12,12 -12,12');
  } else if (appearance.shape === 'diamond') {
    shape.setAttribute('points', '0,-12 12,0 0,12 -12,0');
  } else {
    shape.setAttribute('x', '-12');
    shape.setAttribute('y', '-12');
    shape.setAttribute('width', '24');
    shape.setAttribute('height', '24');
    shape.setAttribute('rx', '3');
  }
  const area = appearance.shape === 'square';
  shape.setAttribute('fill', area ? 'none' : color);
  shape.setAttribute('stroke', '#fff');
  shape.setAttribute('stroke-width', '2');
  if (appearance.dotted || area) shape.setAttribute('stroke-dasharray', '2 2');
  svg.append(shape);
  if ('label' in appearance) {
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', '0');
    text.setAttribute('y', '4');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-family', 'DejaVu Sans, sans-serif');
    text.setAttribute('font-size', '10');
    text.setAttribute('font-weight', 'bold');
    text.setAttribute(
      'fill',
      'textColor' in appearance ? (appearance.textColor ?? '#fff') : '#fff',
    );
    text.textContent = appearance.label;
    svg.append(text);
  }
  return svg;
}

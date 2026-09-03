import { t } from '../i18n.js';
import { TEAM_COLOR_BINDINGS, getTeamColor } from '../state/teamColors.js';

export function bindingSelectHtml(current, opts = {}) {
    const val = TEAM_COLOR_BINDINGS.includes(current) ? current : 'static';
    const disabled = opts.disabled ? 'disabled' : '';
    return `<select class="color-binding-select" title="${t('colorBinding.title')}" ${disabled}>
        ${TEAM_COLOR_BINDINGS.map(b =>
            `<option value="${b}" ${b === val ? 'selected' : ''}>${t(`colorBinding.${b}`)}</option>`
        ).join('')}
    </select>`;
}

export function effectiveColor(hex, binding) {
    if (binding && binding !== 'static') {
        const bound = getTeamColor(binding);
        if (bound) return bound;
    }
    return hex;
}

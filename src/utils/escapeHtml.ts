/** HTML special karakterlerini escape eder — XSS onlemi */
const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, ch => map[ch]);
}

// Small Markdown renderer (headings, lists, tables, code blocks, quotes, inline formatting)
// shared by the AI assistant and the scripts page. Code blocks with language "echarts" become chart placeholders.
window.ViMarkdown = (function () {
    'use strict';

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function inlineMd(s) {
        const codes = [];
        s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
        s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + codes[+i] + '</code>');
        return s;
    }

    function splitRow(line) {
        let l = line.trim();
        if (l.startsWith('|')) l = l.slice(1);
        if (l.endsWith('|')) l = l.slice(0, -1);
        return l.split('|').map((c) => c.trim());
    }

    function renderMarkdown(text, opts) {
        opts = opts || {};
        const blocks = [];
        // Fenced code blocks first (content stays raw)
        let src = text.replace(/```(\w*)[^\n]*\n([\s\S]*?)(```|$)/g, (m, lang, code, close) => {
            blocks.push({ lang: lang.toLowerCase(), code: code.replace(/\n$/, ''), closed: close === '```' });
            return '\n\u0001' + (blocks.length - 1) + '\u0001\n';
        });
        src = escapeHtml(src);

        const lines = src.split('\n');
        const out = [];
        let para = [];
        const flush = () => { if (para.length) { out.push('<p>' + inlineMd(para.join('<br>')) + '</p>'); para = []; } };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const t = line.trim();
            let m;

            if ((m = t.match(/^\u0001(\d+)\u0001$/))) {
                flush();
                const b = blocks[+m[1]];
                if (b.lang === 'echarts' || b.lang === 'chart') {
                    if (opts.streaming || !b.closed) {
                        out.push('<p class="typing">Diagramm wird erstellt</p>');
                    } else {
                        out.push('<div class="chart" data-chart="' + escapeHtml(b.code) + '"></div>');
                    }
                } else {
                    out.push('<pre data-lang="' + escapeHtml(b.lang) + '"><code>' + escapeHtml(b.code) + '</code></pre>');
                }
                continue;
            }
            if (!t) { flush(); continue; }
            if ((m = t.match(/^(#{1,4})\s+(.*)$/))) {
                flush();
                const lvl = m[1].length;
                out.push('<h' + lvl + '>' + inlineMd(m[2]) + '</h' + lvl + '>');
                continue;
            }
            if (/^(-{3,}|\*{3,})$/.test(t)) { flush(); out.push('<hr>'); continue; }

            // Table: header row followed by separator row
            if (t.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(lines[i + 1].trim())) {
                flush();
                const head = splitRow(t);
                const rows = [];
                i += 2;
                while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitRow(lines[i])); i++; }
                i--;
                const isNum = (c) => /^[-+]?[\d.,]+\s*(%|°C|K|kWh|kW|W|€|h|l\/h)?$/.test(c);
                let html = '<div class="table-wrap"><table><thead><tr>' + head.map((h) => '<th>' + inlineMd(h) + '</th>').join('') + '</tr></thead><tbody>';
                rows.forEach((r) => {
                    html += '<tr>' + r.map((c) => '<td' + (isNum(c) ? ' class="num"' : '') + '>' + inlineMd(c) + '</td>').join('') + '</tr>';
                });
                out.push(html + '</tbody></table></div>');
                continue;
            }

            // Lists
            if (/^([-*+]|\d+[.)])\s+/.test(t)) {
                flush();
                const ordered = /^\d+[.)]/.test(t);
                const items = [];
                while (i < lines.length && /^([-*+]|\d+[.)])\s+/.test(lines[i].trim())) {
                    items.push(lines[i].trim().replace(/^([-*+]|\d+[.)])\s+/, ''));
                    // continuation lines (indented)
                    while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i + 1])) {
                        items[items.length - 1] += '<br>' + lines[i + 1].trim();
                        i++;
                    }
                    i++;
                }
                i--;
                const tag = ordered ? 'ol' : 'ul';
                out.push('<' + tag + '>' + items.map((it) => '<li>' + inlineMd(it) + '</li>').join('') + '</' + tag + '>');
                continue;
            }
            if (t.startsWith('&gt;')) {
                flush();
                const q = [];
                while (i < lines.length && lines[i].trim().startsWith('&gt;')) { q.push(lines[i].trim().replace(/^&gt;\s?/, '')); i++; }
                i--;
                out.push('<blockquote>' + inlineMd(q.join('<br>')) + '</blockquote>');
                continue;
            }
            para.push(t);
        }
        flush();
        return out.join('');
    }

    return { escapeHtml: escapeHtml, render: renderMarkdown };
})();

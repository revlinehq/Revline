import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { SubjectToolsLab } from '../../components/dev/subject-tools-lab';

test.each(['tracking', 'masking'] as const)('%s tools render on the server without browser media APIs or a model request', mode => {
  const request = vi.spyOn(globalThis, 'fetch');
  try {
    const html = renderToStaticMarkup(<SubjectToolsLab mode={mode} />);
    expect(html).toContain('Choose local video');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('<video');
    expect(request).not.toHaveBeenCalled();
    if (mode === 'masking') {
      expect(html).toContain('uses Meta API credits');
      expect(html).toContain('Find subject');
      expect(html).toContain('frames without a returned mask show original footage');
    } else expect(html).toContain('Free local processing');
  } finally { request.mockRestore(); }
});

import { updateSection } from '../../src/textUtils';

jest.mock('../../src/fileUtils', () => ({
  getEditorForFile: jest.fn().mockReturnValue(null) // Simulate closed editor
}));

describe('updateSection', () => {
  const heading = '## Granola Notes';

  let mockApp: any;
  let mockFile: any;

  beforeEach(() => {
    mockFile = { path: 'test.md' };
    mockApp = {
      vault: {
        read: jest.fn(),
        modify: jest.fn()
      },
      workspace: {
        iterateAllLeaves: jest.fn()
      }
    };
  });

  it('should append new section when heading is absent', async () => {
    const initialContent = '# Title\nSome content';
    const sectionContent = `${heading}\nNew content line`;

    mockApp.vault.read.mockResolvedValueOnce(initialContent);

    await updateSection(mockApp, mockFile, heading, sectionContent);

    const expected = '# Title\nSome content\n\n' + sectionContent;
    expect(mockApp.vault.modify).toHaveBeenCalledWith(mockFile, expected);
  });

  it('should replace existing section when heading is present', async () => {
    const initialContent = [
      '# Title',
      'Intro line',
      heading,
      'Old content line',
      '## Another Section',
      'Trailing line'
    ].join('\n');

    const sectionContent = `${heading}\nNew content line`;

    mockApp.vault.read.mockResolvedValueOnce(initialContent);

    await updateSection(mockApp, mockFile, heading, sectionContent);

    const expected = [
      '# Title',
      'Intro line',
      sectionContent,
      '## Another Section',
      'Trailing line'
    ].join('\n');

    expect(mockApp.vault.modify).toHaveBeenCalledWith(mockFile, expected);
  });
});
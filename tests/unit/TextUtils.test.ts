import { getHeadingLevel, toHeading, groupBy, updateProperties, updateSection } from '../../src/textUtils';
import { getEditorForFile } from '../../src/fileUtils';

jest.mock('../../src/fileUtils', () => ({
  getEditorForFile: jest.fn()
}));

describe('textUtils helpers', () => {
  describe('getHeadingLevel', () => {
    it('should detect heading level based on number of # characters', () => {
      expect(getHeadingLevel('# Heading')).toBe(1);
      expect(getHeadingLevel('## Heading')).toBe(2);
      expect(getHeadingLevel('###### Heading')).toBe(6);
    });

    it('should return null when the line is not a markdown heading', () => {
      expect(getHeadingLevel('No heading here')).toBeNull();
      expect(getHeadingLevel('   ###MissingSpace')).toBeNull();
    });
  });

  describe('toHeading', () => {
    it('should prefix the title with the correct number of # symbols', () => {
      expect(toHeading('My Title', 1)).toBe('# My Title');
      expect(toHeading('My Title', 3)).toBe('### My Title');
    });
  });

  describe('groupBy', () => {
    const data = [
      { id: 1, category: 'a' },
      { id: 2, category: 'b' },
      { id: 3, category: 'a' }
    ];

    it('should group array items by predicate key', () => {
      const grouped = groupBy(data, (item) => item.category);
      expect(grouped).toEqual({
        a: [data[0], data[2]],
        b: [data[1]]
      });
    });
  });
});

describe('updateProperties & updateSection', () => {
  let mockApp: jest.Mocked<any>;
  let mockVault: any;
  let mockFile: any;

  beforeEach(() => {
    mockVault = {
      read: jest.fn(),
      modify: jest.fn()
    };

    mockApp = {
      vault: mockVault
    } as unknown as jest.Mocked<any>;

    mockFile = { path: 'test.md' };

    // By default there is no open editor for the file
    (getEditorForFile as jest.Mock).mockReturnValue(null);
  });

  describe('updateProperties', () => {
    const newProperties = ['---', 'tags: test', '---'].join('\n');

    it('should prepend a new properties block when none exists', async () => {
      mockVault.read.mockResolvedValueOnce('Content line');

      await updateProperties(mockApp, mockFile, newProperties);

      const modifiedText = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedText.startsWith(newProperties)).toBe(true);
    });

    it('should replace an existing properties block at the top of the file', async () => {
      const existing = ['---', 'old: property', '---', 'Old content'].join('\n');
      mockVault.read.mockResolvedValueOnce(existing);

      await updateProperties(mockApp, mockFile, newProperties);

      // The modified text should start with the new properties and not contain the old one
      const modifiedText = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedText.startsWith(newProperties)).toBe(true);
      expect(modifiedText).not.toContain('old: property');
    });
  });

  describe('updateSection', () => {
    const heading = '## Granola Notes';
    const sectionContent = `${heading}\nNew synced content`;

    it('should append a new section when the heading does not exist', async () => {
      mockVault.read.mockResolvedValueOnce('File without heading');

      await updateSection(mockApp, mockFile, heading, sectionContent);

      const modified = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modified.trimEnd()).toContain(sectionContent);
    });

    it('should replace the existing section when the heading is present', async () => {
      const existingFile = [
        '# Title',
        '',
        heading,
        'Old content',
        '# Another heading',
        'More'
      ].join('\n');

      mockVault.read.mockResolvedValueOnce(existingFile);

      await updateSection(mockApp, mockFile, heading, sectionContent);

      const modified = (mockVault.modify as jest.Mock).mock.calls[0][1];
      // The new content should be in place of old content
      expect(modified).toContain(sectionContent);
      expect(modified).not.toContain('Old content');
    });
  });
});
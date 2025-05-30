import { IFileSystem } from '../interfaces';

export interface ICredentialService {
  loadCredentials(tokenPath: string): Promise<CredentialResult>;
  getAccessToken(): string | null;
  getLastError(): string | null;
}

export interface CredentialResult {
  accessToken: string | null;
  error: string | null;
}

export class CredentialService implements ICredentialService {
  private accessToken: string | null = null;
  private lastError: string | null = null;

  constructor(private fileSystem: IFileSystem) {}

  async loadCredentials(tokenPath: string): Promise<CredentialResult> {
    this.accessToken = null;
    this.lastError = null;

    try {
      // Validate token path
      const validationResult = this.validateTokenPath(tokenPath);
      if (validationResult.error) {
        this.lastError = validationResult.error;
        return { accessToken: null, error: this.lastError };
      }

      // Check if file exists
      if (!(await this.fileSystem.exists(tokenPath))) {
        this.lastError = `Credentials file not found at '${tokenPath}'. Please check the path in settings.`;
        return { accessToken: null, error: this.lastError };
      }

      // Read and parse credentials
      const tokenFileContent = await this.fileSystem.read(tokenPath);
      const parsedCredentials = this.parseCredentials(tokenFileContent);
      
      if (parsedCredentials.error) {
        this.lastError = parsedCredentials.error;
        return { accessToken: null, error: this.lastError };
      }

      this.accessToken = parsedCredentials.accessToken;
      return { accessToken: this.accessToken, error: null };

    } catch (error) {
      this.lastError = 'Failed to load credentials. Please check if the file exists and is accessible.';
      console.error('Credentials loading error:', error);
      return { accessToken: null, error: this.lastError };
    }
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  private validateTokenPath(tokenPath: string): { error: string | null } {
    if (!tokenPath) {
      return { error: 'Token path is not configured in settings.' };
    }

    if (this.isAbsolutePath(tokenPath)) {
      return {
        error: 'Token path appears to be an absolute path. Please ensure it\'s a path relative to your vault root, e.g., \'configs/supabase.json\'. Plugins typically cannot access arbitrary file system locations.'
      };
    }

    return { error: null };
  }

  private isAbsolutePath(path: string): boolean {
    // Check for Unix absolute path (starts with /)
    if (path.startsWith('/')) {
      return true;
    }

    // Check for Windows absolute path (starts with drive letter like C:\)
    if (path.match(/^[A-Za-z]:\\/)) {
      return true;
    }

    return false;
  }

  private parseCredentials(tokenFileContent: string): { accessToken: string | null; error: string | null } {
    try {
      const tokenData = JSON.parse(tokenFileContent);
      
      if (!tokenData.cognito_tokens) {
        return { 
          accessToken: null, 
          error: 'No cognito_tokens found in credentials file. Please ensure the file is properly formatted.' 
        };
      }

      const cognitoTokens = JSON.parse(tokenData.cognito_tokens);
      const accessToken = cognitoTokens.access_token;

      if (!accessToken) {
        return { 
          accessToken: null, 
          error: 'No access token found in credentials file. The token may have expired.' 
        };
      }

      return { accessToken, error: null };

    } catch (parseError) {
      console.error('Token file parse error:', parseError);
      return { 
        accessToken: null, 
        error: 'Invalid JSON format in credentials file. Please ensure the file is properly formatted.' 
      };
    }
  }
}
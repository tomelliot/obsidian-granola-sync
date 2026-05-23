import { presentCredentialsError } from "../../src/services/credentialsErrorPresenter";

describe("presentCredentialsError", () => {
  let onKeychainDenied: jest.Mock;
  let onOtherError: jest.Mock;

  beforeEach(() => {
    onKeychainDenied = jest.fn();
    onOtherError = jest.fn();
  });

  it("calls neither handler when credentials loaded successfully", () => {
    presentCredentialsError(
      { accessToken: "tok", error: null },
      { onKeychainDenied, onOtherError }
    );

    expect(onKeychainDenied).not.toHaveBeenCalled();
    expect(onOtherError).not.toHaveBeenCalled();
  });

  it("calls onKeychainDenied when the failure is a keychain access denial", () => {
    presentCredentialsError(
      {
        accessToken: null,
        error: "Could not read Granola password from system keychain.",
        errorKind: "keychain",
      },
      { onKeychainDenied, onOtherError }
    );

    expect(onKeychainDenied).toHaveBeenCalledTimes(1);
    expect(onOtherError).not.toHaveBeenCalled();
  });

  it("calls onOtherError for decryption failures, with the error message", () => {
    presentCredentialsError(
      {
        accessToken: null,
        error: "Failed to decrypt Granola credentials.",
        errorKind: "decryption",
      },
      { onKeychainDenied, onOtherError }
    );

    expect(onOtherError).toHaveBeenCalledWith(
      "Failed to decrypt Granola credentials."
    );
    expect(onKeychainDenied).not.toHaveBeenCalled();
  });

  it("calls onOtherError for file-not-found failures", () => {
    presentCredentialsError(
      {
        accessToken: null,
        error: "Granola credentials file not found.",
        errorKind: "file_not_found",
      },
      { onKeychainDenied, onOtherError }
    );

    expect(onOtherError).toHaveBeenCalledWith(
      "Granola credentials file not found."
    );
    expect(onKeychainDenied).not.toHaveBeenCalled();
  });

  it("calls onOtherError when errorKind is missing but error is set", () => {
    presentCredentialsError(
      { accessToken: null, error: "Something went wrong" },
      { onKeychainDenied, onOtherError }
    );

    expect(onOtherError).toHaveBeenCalledWith("Something went wrong");
    expect(onKeychainDenied).not.toHaveBeenCalled();
  });

  it("treats an empty access token as an error using error message fallback", () => {
    presentCredentialsError(
      { accessToken: null, error: "No access token loaded." },
      { onKeychainDenied, onOtherError }
    );

    expect(onOtherError).toHaveBeenCalledWith("No access token loaded.");
    expect(onKeychainDenied).not.toHaveBeenCalled();
  });
});

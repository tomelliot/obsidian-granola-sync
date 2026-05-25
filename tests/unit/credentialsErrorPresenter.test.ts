import { presentCredentialsError } from "../../src/services/credentialsErrorPresenter";

describe("presentCredentialsError", () => {
  let onKeychainDenied: jest.Mock;
  let onDpapiFailed: jest.Mock;
  let onOtherError: jest.Mock;

  beforeEach(() => {
    onKeychainDenied = jest.fn();
    onDpapiFailed = jest.fn();
    onOtherError = jest.fn();
  });

  it("calls no handler when credentials loaded successfully", () => {
    presentCredentialsError(
      { accessToken: "tok", error: null },
      { onKeychainDenied, onDpapiFailed, onOtherError }
    );

    expect(onKeychainDenied).not.toHaveBeenCalled();
    expect(onDpapiFailed).not.toHaveBeenCalled();
    expect(onOtherError).not.toHaveBeenCalled();
  });

  it("calls onKeychainDenied when the failure is a keychain access denial", () => {
    presentCredentialsError(
      {
        accessToken: null,
        error: "Could not read Granola password from system keychain.",
        errorKind: "keychain",
      },
      { onKeychainDenied, onDpapiFailed, onOtherError }
    );

    expect(onKeychainDenied).toHaveBeenCalledTimes(1);
    expect(onDpapiFailed).not.toHaveBeenCalled();
    expect(onOtherError).not.toHaveBeenCalled();
  });

  it("calls onDpapiFailed with the message when the failure is a Windows DPAPI failure", () => {
    presentCredentialsError(
      {
        accessToken: null,
        error: "Could not unwrap Granola's encryption key via Windows DPAPI.",
        errorKind: "dpapi",
      },
      { onKeychainDenied, onDpapiFailed, onOtherError }
    );

    expect(onDpapiFailed).toHaveBeenCalledWith(
      "Could not unwrap Granola's encryption key via Windows DPAPI."
    );
    expect(onKeychainDenied).not.toHaveBeenCalled();
    expect(onOtherError).not.toHaveBeenCalled();
  });

  it("calls onOtherError for decryption failures, with the error message", () => {
    presentCredentialsError(
      {
        accessToken: null,
        error: "Failed to decrypt Granola credentials.",
        errorKind: "decryption",
      },
      { onKeychainDenied, onDpapiFailed, onOtherError }
    );

    expect(onOtherError).toHaveBeenCalledWith(
      "Failed to decrypt Granola credentials."
    );
    expect(onKeychainDenied).not.toHaveBeenCalled();
    expect(onDpapiFailed).not.toHaveBeenCalled();
  });

  it("calls onOtherError for file-not-found failures", () => {
    presentCredentialsError(
      {
        accessToken: null,
        error: "Granola credentials file not found.",
        errorKind: "file_not_found",
      },
      { onKeychainDenied, onDpapiFailed, onOtherError }
    );

    expect(onOtherError).toHaveBeenCalledWith(
      "Granola credentials file not found."
    );
    expect(onKeychainDenied).not.toHaveBeenCalled();
    expect(onDpapiFailed).not.toHaveBeenCalled();
  });

  it("calls onOtherError when errorKind is missing but error is set", () => {
    presentCredentialsError(
      { accessToken: null, error: "Something went wrong" },
      { onKeychainDenied, onDpapiFailed, onOtherError }
    );

    expect(onOtherError).toHaveBeenCalledWith("Something went wrong");
    expect(onKeychainDenied).not.toHaveBeenCalled();
    expect(onDpapiFailed).not.toHaveBeenCalled();
  });

  it("treats an empty access token as an error using error message fallback", () => {
    presentCredentialsError(
      { accessToken: null, error: "No access token loaded." },
      { onKeychainDenied, onDpapiFailed, onOtherError }
    );

    expect(onOtherError).toHaveBeenCalledWith("No access token loaded.");
    expect(onKeychainDenied).not.toHaveBeenCalled();
    expect(onDpapiFailed).not.toHaveBeenCalled();
  });
});

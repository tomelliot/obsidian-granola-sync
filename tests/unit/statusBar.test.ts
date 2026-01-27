import { Plugin } from "obsidian";
import {
  showStatusBar,
  hideStatusBar,
  showStatusBarTemporary,
} from "../../src/utils/statusBar";

describe("statusBar", () => {
  let mockPlugin: any;
  let mockStatusBarItem: any;

  beforeEach(() => {
    jest.useFakeTimers();
    mockStatusBarItem = {
      setText: jest.fn(),
      style: { display: "" },
      remove: jest.fn(),
    };

    mockPlugin = {
      statusBarItemEl: null,
      statusBarTimeoutId: null,
      addStatusBarItem: jest.fn().mockReturnValue(mockStatusBarItem),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe("showStatusBar", () => {
    it("should create status bar item if it doesn't exist", () => {
      showStatusBar(mockPlugin, "Test message");

      expect(mockPlugin.addStatusBarItem).toHaveBeenCalled();
      expect(mockStatusBarItem.setText).toHaveBeenCalledWith("Test message");
      expect(mockStatusBarItem.style.display).toBe("");
      expect(mockPlugin.statusBarItemEl).toBe(mockStatusBarItem);
    });

    it("should update existing status bar item", () => {
      mockPlugin.statusBarItemEl = mockStatusBarItem;

      showStatusBar(mockPlugin, "Updated message");

      expect(mockPlugin.addStatusBarItem).not.toHaveBeenCalled();
      expect(mockStatusBarItem.setText).toHaveBeenCalledWith("Updated message");
      expect(mockStatusBarItem.style.display).toBe("");
    });
  });

  describe("hideStatusBar", () => {
    it("should clear timeout if one exists", () => {
      mockPlugin.statusBarItemEl = mockStatusBarItem;
      mockPlugin.statusBarTimeoutId = 123;
      window.clearTimeout = jest.fn();

      hideStatusBar(mockPlugin);

      expect(window.clearTimeout).toHaveBeenCalledWith(123);
      expect(mockPlugin.statusBarTimeoutId).toBeNull();
    });

    it("should remove status bar item if it exists", () => {
      mockPlugin.statusBarItemEl = mockStatusBarItem;

      hideStatusBar(mockPlugin);

      expect(mockStatusBarItem.remove).toHaveBeenCalled();
      expect(mockPlugin.statusBarItemEl).toBeNull();
    });

    it("should handle case when status bar item doesn't exist", () => {
      mockPlugin.statusBarItemEl = null;

      expect(() => hideStatusBar(mockPlugin)).not.toThrow();
    });

    it("should handle case when timeout doesn't exist", () => {
      mockPlugin.statusBarItemEl = mockStatusBarItem;
      mockPlugin.statusBarTimeoutId = null;
      window.clearTimeout = jest.fn();

      hideStatusBar(mockPlugin);

      expect(window.clearTimeout).not.toHaveBeenCalled();
    });
  });

  describe("showStatusBarTemporary", () => {
    it("should show status bar and hide after default duration", () => {
      showStatusBarTemporary(mockPlugin, "Temporary message");

      expect(mockStatusBarItem.setText).toHaveBeenCalledWith("Temporary message");
      expect(mockPlugin.statusBarItemEl).toBe(mockStatusBarItem);

      // Fast-forward default duration (5000ms)
      jest.advanceTimersByTime(5000);

      expect(mockStatusBarItem.remove).toHaveBeenCalled();
      expect(mockPlugin.statusBarItemEl).toBeNull();
      expect(mockPlugin.statusBarTimeoutId).toBeNull();
    });

    it("should show status bar and hide after custom duration", () => {
      showStatusBarTemporary(mockPlugin, "Custom duration", 3000);

      expect(mockStatusBarItem.setText).toHaveBeenCalledWith("Custom duration");

      // Fast-forward custom duration (3000ms)
      jest.advanceTimersByTime(3000);

      expect(mockStatusBarItem.remove).toHaveBeenCalled();
      expect(mockPlugin.statusBarItemEl).toBeNull();
    });

    it("should clear existing timeout before setting new one", () => {
      mockPlugin.statusBarTimeoutId = 456;
      window.clearTimeout = jest.fn();

      showStatusBarTemporary(mockPlugin, "New message");

      expect(window.clearTimeout).toHaveBeenCalledWith(456);
      expect(mockPlugin.statusBarTimeoutId).not.toBe(456);
    });

    it("should return the timeout ID", () => {
      const timeoutId = showStatusBarTemporary(mockPlugin, "Test");

      expect(typeof timeoutId).toBe("number");
      expect(mockPlugin.statusBarTimeoutId).toBe(timeoutId);
    });

    it("should not hide before duration expires", () => {
      showStatusBarTemporary(mockPlugin, "Wait message", 5000);

      // Fast-forward less than duration
      jest.advanceTimersByTime(3000);

      expect(mockStatusBarItem.remove).not.toHaveBeenCalled();

      // Fast-forward remaining time
      jest.advanceTimersByTime(2000);

      expect(mockStatusBarItem.remove).toHaveBeenCalled();
    });
  });
});

import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

function ToggleButton() {
  const [enabled, setEnabled] = useState(false);

  return (
    <button type="button" onClick={() => setEnabled((value) => !value)}>
      {enabled ? "已启用" : "未启用"}
    </button>
  );
}

describe("React Testing Library setup", () => {
  it("renders React components and handles user events", async () => {
    const user = userEvent.setup();
    render(<ToggleButton />);

    const button = screen.getByRole("button", { name: "未启用" });
    await user.click(button);

    expect(button).toHaveTextContent("已启用");
  });
});

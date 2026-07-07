import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RenameSessionDialog } from "./RenameSessionDialog";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

it("trims a submitted name and does not close until persistence succeeds", async () => {
  const save = deferred();
  const onSubmit = vi.fn(() => save.promise);
  const onClose = vi.fn();
  const user = userEvent.setup();

  render(
    <RenameSessionDialog
      initialTitle="Old name"
      onSubmit={onSubmit}
      onClose={onClose}
    />,
  );

  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "  New name  ");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Saving…" }));

  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith("New name");
  expect(onClose).not.toHaveBeenCalled();

  save.resolve();
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});

it("submits an empty string to clear a custom session name", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const user = userEvent.setup();

  render(
    <RenameSessionDialog
      initialTitle="Custom alias"
      onSubmit={onSubmit}
      onClose={onClose}
    />,
  );

  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "   ");
  await user.keyboard("{Enter}");

  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(""));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("cancel leaves the edited value unsubmitted", async () => {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup();

  render(
    <RenameSessionDialog
      initialTitle="Original"
      onSubmit={onSubmit}
      onClose={onClose}
    />,
  );

  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Discarded edit");
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onSubmit).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
});

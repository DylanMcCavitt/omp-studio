// F1 — the shared prompt composer. Exercises the user-facing attachment +
// submit contract end to end through the real file input and validation lib:
// attaching renders thumbnails, removal drops them, oversized / too-many files
// are rejected with inline errors, and submit clears only on success (a failed
// send restores text + attachments for retry). Assertions go through roles and
// values, never styling.

import type { ImageContent } from "@shared/rpc";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MAX_IMAGE_BYTES, MAX_IMAGES } from "@/lib/images";
import { PromptComposer } from "./PromptComposer";

/** A small in-spec image File. `size` can be overridden to fake an oversized one. */
function imageFile(name: string, size?: number): File {
  const file = new File(["x"], name, { type: "image/png" });
  if (size !== undefined) {
    Object.defineProperty(file, "size", { value: size });
  }
  return file;
}

/** Render the composer with a Send button wired to ctx.submit. */
function renderComposer(
  onSubmit: (
    text: string,
    images: ImageContent[],
  ) => boolean | Promise<boolean>,
) {
  return render(
    <PromptComposer
      onSubmit={onSubmit}
      placeholder="Message"
      renderActions={({ submit, canSubmit }) => (
        <button type="button" onClick={submit} disabled={!canSubmit}>
          Send
        </button>
      )}
    />,
  );
}

/** The component's hidden file input (it carries no label of its own). */
function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("file input not found");
  return input;
}

it("attaches a picked image and shows its thumbnail", async () => {
  const user = userEvent.setup();
  const { container } = renderComposer(vi.fn().mockResolvedValue(true));

  await user.upload(fileInput(container), imageFile("pic.png"));

  expect(
    await screen.findByRole("img", { name: "pic.png" }),
  ).toBeInTheDocument();
});

it("removes an attached image via its remove button", async () => {
  const user = userEvent.setup();
  const { container } = renderComposer(vi.fn().mockResolvedValue(true));

  await user.upload(fileInput(container), imageFile("pic.png"));
  expect(
    await screen.findByRole("img", { name: "pic.png" }),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Remove pic.png" }));
  expect(
    screen.queryByRole("img", { name: "pic.png" }),
  ).not.toBeInTheDocument();
});

it("rejects an oversized image with an inline error and no thumbnail", async () => {
  const user = userEvent.setup();
  const { container } = renderComposer(vi.fn().mockResolvedValue(true));

  await user.upload(
    fileInput(container),
    imageFile("huge.png", MAX_IMAGE_BYTES + 1),
  );

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/huge\.png/);
  expect(alert).toHaveTextContent(/max/i);
  expect(
    screen.queryByRole("img", { name: "huge.png" }),
  ).not.toBeInTheDocument();
});

it("caps attachments at MAX_IMAGES and reports the overflow", async () => {
  const user = userEvent.setup();
  const { container } = renderComposer(vi.fn().mockResolvedValue(true));

  const files = Array.from({ length: MAX_IMAGES + 1 }, (_, i) =>
    imageFile(`pic-${i}.png`),
  );
  await user.upload(fileInput(container), files);

  await waitFor(() =>
    expect(screen.getAllByRole("img")).toHaveLength(MAX_IMAGES),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    `Up to ${MAX_IMAGES} images per message`,
  );
});

it("clears text after a successful submit", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn().mockResolvedValue(true);
  renderComposer(onSubmit);

  const textarea = screen.getByPlaceholderText("Message");
  await user.type(textarea, "ship it");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(onSubmit).toHaveBeenCalledWith("ship it", []);
  await waitFor(() => expect(textarea).toHaveValue(""));
});

it("restores text AND attachments after a failed submit so they can be retried", async () => {
  const user = userEvent.setup();
  // First submit fails (keep everything), second succeeds (then clears).
  const onSubmit = vi
    .fn()
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  const { container } = renderComposer(onSubmit);

  const textarea = screen.getByPlaceholderText("Message");
  await user.upload(fileInput(container), imageFile("pic.png"));
  expect(
    await screen.findByRole("img", { name: "pic.png" }),
  ).toBeInTheDocument();
  await user.type(textarea, "retry me");

  // Failed submit: text AND the thumbnail must survive for a retry.
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(textarea).toHaveValue("retry me");
  expect(screen.getByRole("img", { name: "pic.png" })).toBeInTheDocument();

  // The failed call carried the full payload (text + one image)...
  const failedCall = onSubmit.mock.calls[0];
  expect(failedCall[0]).toBe("retry me");
  expect(failedCall[1]).toHaveLength(1);
  expect(failedCall[1][0]).toMatchObject({
    type: "image",
    mimeType: "image/png",
  });

  // ...and the retry resends the identical preserved payload.
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  const retryCall = onSubmit.mock.calls[1];
  expect(retryCall[0]).toBe("retry me");
  expect(retryCall[1]).toHaveLength(1);
  expect(retryCall[1][0]).toMatchObject({
    type: "image",
    mimeType: "image/png",
  });

  // The successful retry then clears the composer.
  await waitFor(() => expect(textarea).toHaveValue(""));
  expect(
    screen.queryByRole("img", { name: "pic.png" }),
  ).not.toBeInTheDocument();
});

it("submits attachments alongside text", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn().mockResolvedValue(true);
  const { container } = renderComposer(onSubmit);

  await user.upload(fileInput(container), imageFile("pic.png"));
  expect(
    await screen.findByRole("img", { name: "pic.png" }),
  ).toBeInTheDocument();
  await user.type(screen.getByPlaceholderText("Message"), "look");
  await user.click(screen.getByRole("button", { name: "Send" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  const [text, images] = onSubmit.mock.calls[0];
  expect(text).toBe("look");
  expect(images).toHaveLength(1);
  expect(images[0]).toMatchObject({ type: "image", mimeType: "image/png" });
});

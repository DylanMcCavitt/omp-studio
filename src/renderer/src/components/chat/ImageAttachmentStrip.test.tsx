// F1 — the attachment strip rendered above the composer. Pure presentational
// component: given attachments it shows an alt-labelled thumbnail per image with
// an accessible remove control, and given errors it announces them in an alert
// region. Verified through roles + the remove callback, not styling.

import type { ImageContent } from "@shared/rpc";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ImageAttachment } from "@/lib/images";
import { ImageAttachmentStrip } from "./ImageAttachmentStrip";

function attachment(id: string, name: string): ImageAttachment {
  const content: ImageContent = {
    type: "image",
    data: "QUJD", // base64 for "ABC" — enough for imageBlockSrc to build a src
    mimeType: "image/png",
  };
  return { id, content, name, size: 1234 };
}

it("renders nothing when there are no attachments or errors", () => {
  const { container } = render(
    <ImageAttachmentStrip attachments={[]} errors={[]} onRemove={vi.fn()} />,
  );
  expect(container).toBeEmptyDOMElement();
});

it("renders an alt-labelled thumbnail per attachment", () => {
  render(
    <ImageAttachmentStrip
      attachments={[attachment("a", "one.png"), attachment("b", "two.png")]}
      errors={[]}
      onRemove={vi.fn()}
    />,
  );
  expect(screen.getByRole("img", { name: "one.png" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "two.png" })).toBeInTheDocument();
});

it("removes the targeted attachment via its labelled button", async () => {
  const user = userEvent.setup();
  const onRemove = vi.fn();
  render(
    <ImageAttachmentStrip
      attachments={[attachment("a", "one.png"), attachment("b", "two.png")]}
      errors={[]}
      onRemove={onRemove}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Remove two.png" }));
  expect(onRemove).toHaveBeenCalledTimes(1);
  expect(onRemove).toHaveBeenCalledWith("b");
});

it("announces validation errors in an alert region", () => {
  render(
    <ImageAttachmentStrip
      attachments={[]}
      errors={["foo.txt is not an image", "Up to 10 images per message"]}
      onRemove={vi.fn()}
    />,
  );
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("foo.txt is not an image");
  expect(alert).toHaveTextContent("Up to 10 images per message");
});

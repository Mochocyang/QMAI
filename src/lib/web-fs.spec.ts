import { expect, test } from "vitest"
import { getWebFs } from "./web-fs"

test("lists parent nodes for nested empty directories created in web fs", async () => {
  const fs = getWebFs()
  const root = `/web-fs-test-${Date.now()}/wiki`

  await fs.createDirectory(`${root}/empty/nested`)

  await expect(fs.listDirectory(root)).resolves.toEqual([
    {
      name: "empty",
      path: `${root}/empty`,
      is_dir: true,
      children: [
        {
          name: "nested",
          path: `${root}/empty/nested`,
          is_dir: true,
          children: [],
        },
      ],
    },
  ])
})

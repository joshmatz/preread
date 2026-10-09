import { isTestFile } from "./file-kinds";
import type { ReviewSection } from "./review-types";

export function displaySections(sections: ReviewSection[], hideTestFiles: boolean) {
  return sections.map((section) => ({
    section,
    files: hideTestFiles
      ? section.files.filter(({ file }) => !isTestFile(file.path))
      : section.files,
  }));
}

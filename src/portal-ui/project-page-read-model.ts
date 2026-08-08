import type { ProjectData } from "./project-data";

export const projectTitle = (data: ProjectData | undefined): string | undefined => {
  if (data?.summary.validity === "available" || data?.summary.validity === "partial") {
    return data.summary.value.title;
  }
  return undefined;
};

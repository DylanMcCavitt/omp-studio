import type { GhIssue, GhPr, GhRepo } from "@shared/domain";
import { ghBinary } from "../paths";
import { runJson } from "./cli";

interface RawAuthor {
  login?: string;
}

interface RawLabel {
  name?: string;
}

interface RawRepo {
  nameWithOwner?: string;
  name?: string;
  description?: string | null;
  isPrivate?: boolean;
  url?: string;
  defaultBranchRef?: { name?: string } | null;
  stargazerCount?: number;
  updatedAt?: string;
  primaryLanguage?: { name?: string } | null;
}

interface RawIssue {
  number?: number;
  title?: string;
  state?: string;
  url?: string;
  author?: RawAuthor;
  createdAt?: string;
  updatedAt?: string;
  labels?: RawLabel[];
  comments?: unknown;
}

interface RawPr {
  number?: number;
  title?: string;
  state?: string;
  url?: string;
  author?: RawAuthor;
  createdAt?: string;
  updatedAt?: string;
  isDraft?: boolean;
  labels?: RawLabel[];
  headRefName?: string;
  baseRefName?: string;
}

const REPO_FIELDS =
  "nameWithOwner,name,description,isPrivate,url,stargazerCount,updatedAt,primaryLanguage";
const ISSUE_FIELDS =
  "number,title,state,url,author,createdAt,updatedAt,labels,comments";
const PR_FIELDS =
  "number,title,state,url,author,createdAt,updatedAt,isDraft,labels,headRefName,baseRefName";

function mapRepo(raw: RawRepo): GhRepo {
  return {
    nameWithOwner: raw.nameWithOwner ?? "",
    name: raw.name ?? "",
    description: raw.description ?? null,
    isPrivate: raw.isPrivate ?? false,
    url: raw.url ?? "",
    defaultBranch: raw.defaultBranchRef?.name,
    stargazerCount: raw.stargazerCount,
    updatedAt: raw.updatedAt,
    primaryLanguage: raw.primaryLanguage?.name ?? null,
  };
}

export async function currentRepo(): Promise<GhRepo | null> {
  const raw = await runJson<RawRepo>(
    ghBinary(),
    ["repo", "view", "--json", `${REPO_FIELDS},defaultBranchRef`],
    { cwd: process.cwd() },
  );
  return raw ? mapRepo(raw) : null;
}

export async function listRepos(): Promise<GhRepo[]> {
  const raw = await runJson<RawRepo[]>(
    ghBinary(),
    ["repo", "list", "--json", REPO_FIELDS, "--limit", "30"],
    { cwd: process.cwd() },
  );
  return raw ? raw.map(mapRepo) : [];
}

export async function listIssues(repo?: string): Promise<GhIssue[]> {
  const args = ["issue", "list"];
  if (repo) args.push("--repo", repo);
  args.push("--json", ISSUE_FIELDS, "--limit", "30");
  const raw = await runJson<RawIssue[]>(ghBinary(), args, {
    cwd: process.cwd(),
  });
  if (!raw) return [];
  return raw.map((i) => {
    const comments =
      typeof i.comments === "number"
        ? i.comments
        : Array.isArray(i.comments)
          ? i.comments.length
          : undefined;
    return {
      number: i.number ?? 0,
      title: i.title ?? "",
      state: i.state ?? "",
      url: i.url ?? "",
      author: i.author?.login ?? "",
      createdAt: i.createdAt ?? "",
      updatedAt: i.updatedAt ?? "",
      labels: (i.labels ?? [])
        .map((l) => l.name ?? "")
        .filter((n) => n.length > 0),
      comments,
    };
  });
}

export async function listPrs(repo?: string): Promise<GhPr[]> {
  const args = ["pr", "list"];
  if (repo) args.push("--repo", repo);
  args.push("--json", PR_FIELDS, "--limit", "30");
  const raw = await runJson<RawPr[]>(ghBinary(), args, { cwd: process.cwd() });
  if (!raw) return [];
  return raw.map((p) => ({
    number: p.number ?? 0,
    title: p.title ?? "",
    state: p.state ?? "",
    url: p.url ?? "",
    author: p.author?.login ?? "",
    createdAt: p.createdAt ?? "",
    updatedAt: p.updatedAt ?? "",
    isDraft: p.isDraft ?? false,
    labels: (p.labels ?? [])
      .map((l) => l.name ?? "")
      .filter((n) => n.length > 0),
    headRefName: p.headRefName,
    baseRefName: p.baseRefName,
  }));
}

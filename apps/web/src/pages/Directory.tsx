import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, ChevronsDownUp, ChevronsUpDown, Crown, Network, RefreshCw, Search, Users } from "lucide-react";
import { get } from "../api";
import type { Change, Department, Paged, Person } from "../lib/types";
import { changeLabel, displayEmail, formatDateTime, statusLabel } from "../lib/format";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  Select,
} from "../components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

type DepartmentResponse = { items: Department[]; snapshot: unknown; rootMemberCount?: number };

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const ROW_HEIGHT = 50;

export default function Directory() {
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [departmentQuery, setDepartmentQuery] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [includeChildren, setIncludeChildren] = useState(true);
  const [pageSizeMode, setPageSizeMode] = useState<"auto" | number>("auto");
  const [autoPageSize, setAutoPageSize] = useState(12);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const expandedInitialized = useRef(false);

  const departmentsQuery = useQuery({
    queryKey: ["directory", "departments"],
    queryFn: () => get<DepartmentResponse>("/directory/departments"),
  });

  useEffect(() => {
    const element = tableRef.current;
    if (!element) return;
    const compute = () => {
      const usable = Math.max(0, element.clientHeight - 40);
      setAutoPageSize(Math.min(100, Math.max(10, Math.floor(usable / ROW_HEIGHT))));
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(element);
    return () => observer.disconnect();
  }, [departmentsQuery.data]);

  const pageSize = pageSizeMode === "auto" ? autoPageSize : pageSizeMode;

  const peopleQuery = useQuery({
    queryKey: ["directory", "people", selectedDepartment, includeChildren, q, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: String(pageSize), page: String(page) });
      if (selectedDepartment) {
        params.set("departmentId", selectedDepartment);
        if (selectedDepartment === "0" || !includeChildren) params.set("direct", "1");
      }
      if (q.trim()) params.set("q", q.trim());
      return get<Paged<Person>>(`/directory/people?${params.toString()}`);
    },
    enabled: Boolean(departmentsQuery.data),
  });

  const totalPages = Math.max(1, Math.ceil((peopleQuery.data?.total ?? 0) / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const detailQuery = useQuery({
    queryKey: ["directory", "person", selectedPerson?.openId],
    queryFn: () =>
      get<{
        person: Person;
        departments: Array<{ id: string; name: string; path: string }>;
        history: Change[];
      }>(`/directory/people/${encodeURIComponent(selectedPerson!.openId)}`),
    enabled: Boolean(selectedPerson),
  });

  const departments = departmentsQuery.data?.items ?? [];
  const byId = useMemo(() => new Map(departments.map((item) => [item.id, item])), [departments]);
  const children = useMemo(() => {
    const map = new Map<string, Department[]>();
    for (const item of departments) {
      if (item.id === "0") continue;
      const list = map.get(item.parentId) ?? [];
      list.push(item);
      map.set(item.parentId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    return map;
  }, [departments]);

  const selectedDepartmentRow =
    selectedDepartment && selectedDepartment !== "0" ? byId.get(selectedDepartment) : undefined;
  const selectedPath = selectedDepartment === "0" ? "公司直属" : selectedDepartmentRow?.path;
  const selectedLeaders = selectedDepartmentRow?.leaders ?? [];
  const selectedLeaderById = new Map(selectedLeaders.map((leader) => [leader.openId, leader]));

  const departmentIds = useMemo(
    () => departments.filter((item) => item.id !== "0").map((item) => item.id),
    [departments],
  );
  const allExpanded = departmentIds.length > 0 && departmentIds.every((id) => expanded.has(id));
  const departmentFilter = departmentQuery.trim().toLowerCase();
  const searchResults = departmentFilter
    ? departments
        .filter(
          (item) =>
            item.id !== "0" &&
            (item.name.toLowerCase().includes(departmentFilter) ||
              item.path.toLowerCase().includes(departmentFilter)),
        )
        .sort((a, b) => a.path.localeCompare(b.path, "zh-CN"))
    : [];

  useEffect(() => {
    if (!departmentsQuery.data || expandedInitialized.current) return;
    const topLevel = departments
      .filter((item) => item.id !== "0" && item.parentId === "0")
      .map((item) => item.id);
    setExpanded(new Set(topLevel));
    expandedInitialized.current = true;
  }, [departmentIds, departmentsQuery.data]);

  const visibleDepartmentIds = useMemo(() => {
    if (!departmentFilter) return null;
    const visible = new Set<string>();
    const addSubtree = (id: string) => {
      if (visible.has(id)) return;
      visible.add(id);
      for (const child of children.get(id) ?? []) addSubtree(child.id);
    };
    for (const item of departments) {
      if (item.id === "0") continue;
      if (!item.name.toLowerCase().includes(departmentFilter) && !item.path.toLowerCase().includes(departmentFilter)) {
        continue;
      }
      let current: Department | undefined = item;
      while (current) {
        visible.add(current.id);
        current = current.parentId && current.parentId !== "0" ? byId.get(current.parentId) : undefined;
      }
      addSubtree(item.id);
    }
    return visible;
  }, [byId, children, departmentFilter, departments]);

  const selectDepartment = (department: Department) => {
    setSelectedDepartment(department.id);
    setDepartmentQuery("");
    setPage(1);
    setExpanded((previous) => {
      const next = new Set(previous);
      let node: Department | undefined = department;
      while (node) {
        next.add(node.id);
        node = node.parentId && node.parentId !== "0" ? byId.get(node.parentId) : undefined;
      }
      return next;
    });
  };

  const toggleDepartment = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setExpanded(allExpanded ? new Set() : new Set(departmentIds));
  };

  const renderDepartment = (department: Department, depth: number): React.ReactNode => {
    if (visibleDepartmentIds && !visibleDepartmentIds.has(department.id)) return null;
    const kids = children.get(department.id) ?? [];
    const isOpen = visibleDepartmentIds ? true : expanded.has(department.id);
    const active = selectedDepartment === department.id;
    const top = depth === 0;
    const leader = department.leaders?.[0];

    if (top) {
      return (
        <div
          key={department.id}
          className={`mb-1.5 overflow-hidden rounded-lg border bg-white shadow-sm transition-colors ${
            active ? "border-primary-200" : "border-slate-200"
          }`}
        >
          <div className={`group relative flex items-center ${active ? "bg-primary-50/60" : "hover:bg-slate-50"}`}>
            {active ? (
              <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-primary-600" />
            ) : null}
            <button
              type="button"
              onClick={() => selectDepartment(department)}
              className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left"
              title={department.path}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                  active ? "bg-white text-primary-700 ring-1 ring-primary-100" : "bg-slate-100 text-slate-500"
                }`}
              >
                <Building2 className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{department.name}</span>
                {leader ? (
                  <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                    主负责人 {leader.name}
                  </span>
                ) : null}
              </span>
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
                  active ? "bg-white/80 text-primary-700" : "bg-slate-100 text-slate-400"
                }`}
              >
                {department.memberCount}
              </span>
            </button>
            {kids.length ? (
              <button
                type="button"
                onClick={() => toggleDepartment(department.id)}
                aria-label={isOpen ? "收起下级部门" : "展开下级部门"}
                className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-white hover:text-slate-600"
              >
                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
              </button>
            ) : (
              <span className="mr-1 w-7 shrink-0" />
            )}
          </div>
          {kids.length && isOpen ? (
            <div className="border-t border-slate-100 bg-slate-50/50 px-1.5 py-1.5">
              {kids.map((child) => renderDepartment(child, 1))}
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div key={department.id}>
        <div
          className={`group relative flex items-center rounded-md transition-colors ${
            active ? "bg-white text-primary-800 shadow-sm ring-1 ring-primary-100" : "text-slate-600 hover:bg-white/70"
          }`}
          style={{ marginLeft: `${(depth - 1) * 14}px` }}
        >
          {active ? (
            <span className="absolute bottom-1 left-0 top-1 w-0.5 rounded-full bg-primary-600" />
          ) : null}
          {kids.length ? (
            <button
              type="button"
              onClick={() => toggleDepartment(department.id)}
              aria-label={isOpen ? "收起下级部门" : "展开下级部门"}
              className="ml-1 flex h-6 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:text-slate-600"
            >
              <ChevronRight className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`} />
            </button>
          ) : (
            <span className="ml-1 w-5 shrink-0" />
          )}
          <button
            type="button"
            onClick={() => selectDepartment(department)}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left"
            title={department.path}
          >
            <span className="min-w-0 flex-1 truncate text-[13px] leading-5">{department.name}</span>
            <span className={`shrink-0 text-[10px] tabular-nums ${active ? "text-primary-600" : "text-slate-400"}`}>
              {department.memberCount}
            </span>
          </button>
        </div>
        {kids.length && isOpen ? (
          <div>{kids.map((child) => renderDepartment(child, depth + 1))}</div>
        ) : null}
      </div>
    );
  };

  const snapshotMeta = departmentsQuery.data?.snapshot as
    | { peopleCount?: number; fetchedAt?: string; departmentCount?: number }
    | undefined;

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100vh-6.5rem)] lg:min-h-[560px]">
      <PageHeader
        title="组织架构"
        description={
          snapshotMeta?.fetchedAt
            ? `最新快照 ${formatDateTime(snapshotMeta.fetchedAt)} · ${snapshotMeta.peopleCount ?? 0} 人 · ${Math.max(
                0,
                (snapshotMeta.departmentCount ?? 1) - 1,
              )} 个部门`
            : "最新一次巡查的组织架构"
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void departmentsQuery.refetch()}
            loading={departmentsQuery.isFetching}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
        }
      />

      {departmentsQuery.isLoading ? (
        <Card className="flex flex-1 items-center justify-center">
          <LoadingBlock />
        </Card>
      ) : departmentsQuery.isError ? (
        <Card className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
            <Network className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium text-slate-800">还没有可用的组织架构快照</p>
          <p className="text-xs text-slate-500">请先在设置中配置飞书应用，然后执行一次巡查。</p>
        </Card>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Card className="flex max-h-[360px] min-h-0 flex-col overflow-hidden lg:max-h-none">
            <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Building2 className="h-4 w-4 text-slate-400" />
                  部门
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  共 {Math.max(0, departments.length - 1)} 个 · 点击查看成员
                </p>
              </div>
              <button
                type="button"
                onClick={toggleAll}
                title={allExpanded ? "收起全部部门" : "展开全部部门"}
                aria-label={allExpanded ? "收起全部部门" : "展开全部部门"}
                className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                {allExpanded ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
              </button>
            </div>

            <div className="shrink-0 px-3 pb-3 pt-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={departmentQuery}
                  onChange={(event) => setDepartmentQuery(event.target.value)}
                  placeholder="搜索部门"
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>

            <div className="ow-scroll flex-1 overflow-y-auto p-2">
              {departmentFilter ? (
                <>
                  <p className="px-2 pb-2 pt-1 text-[11px] text-slate-400">
                    {searchResults.length ? `找到 ${searchResults.length} 个部门` : "没有匹配的部门"}
                  </p>
                  {searchResults.map((department) => (
                    <DepartmentRow
                      key={department.id}
                      department={department}
                      subtitle={department.path}
                      hasChildren={(children.get(department.id) ?? []).length > 0}
                      active={selectedDepartment === department.id}
                      onClick={() => selectDepartment(department)}
                    />
                  ))}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDepartment(null);
                      setPage(1);
                    }}
                    className={`mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors ${
                      selectedDepartment === null
                        ? "bg-primary-50 text-primary-800"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                        selectedDepartment === null
                          ? "bg-white text-primary-700 ring-1 ring-primary-100"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      <Users className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">全部人员</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
                        selectedDepartment === null
                          ? "bg-white/80 text-primary-700"
                          : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      {snapshotMeta?.peopleCount ?? 0}
                    </span>
                  </button>

                  {(departmentsQuery.data?.rootMemberCount ?? 0) > 0 ? (
                    <button
                      type="button"
                      title="直接挂在根部门下、未分配具体部门的成员"
                      onClick={() => {
                        setSelectedDepartment("0");
                        setPage(1);
                      }}
                      className={`mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors ${
                        selectedDepartment === "0"
                          ? "bg-primary-50 text-primary-800"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                          selectedDepartment === "0"
                            ? "bg-white text-primary-700 ring-1 ring-primary-100"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        <Building2 className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">公司直属</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
                          selectedDepartment === "0"
                            ? "bg-white/80 text-primary-700"
                            : "bg-slate-100 text-slate-400"
                        }`}
                      >
                        {departmentsQuery.data?.rootMemberCount ?? 0}
                      </span>
                    </button>
                  ) : null}

                  <div className="mb-1 mt-3 flex items-center gap-2 px-2">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                      部门
                    </span>
                    <span className="h-px flex-1 bg-slate-100" />
                  </div>

                  {(children.get("0") ?? []).map((department) => renderDepartment(department, 0))}
                </>
              )}
            </div>

            <div className="shrink-0 border-t border-slate-100 px-4 py-2 text-center text-[11px] text-slate-400">
              共 {Math.max(0, departments.length - 1)} 个部门 · 点击部门查看成员
            </div>
          </Card>

          <Card className="flex min-h-[420px] flex-col overflow-hidden lg:min-h-0">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-slate-900">{selectedPath ?? "全部人员"}</p>
                  <Badge tone="gray">{peopleQuery.data?.total ?? 0} 人</Badge>
                  {selectedDepartment && selectedDepartment !== "0" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIncludeChildren((value) => !value);
                        setPage(1);
                      }}
                      title="切换是否包含所有子部门成员"
                      className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                        includeChildren
                          ? "border-primary-200 bg-primary-50 text-primary-700"
                          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {includeChildren ? "含子部门" : "仅直属"}
                    </button>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {selectedDepartment === "0"
                    ? "直接挂在根部门下、未分配具体部门"
                    : selectedLeaders.length
                      ? "主负责人 / 负责人均带标识，不重复计入成员数"
                      : "点击成员查看详情与变更历史"}
                </p>
              </div>
              <div className="relative max-w-full">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  className="h-8 w-60 pl-8 text-sm"
                  title="支持姓名、邮箱、工号、职位的模糊搜索"
                  placeholder="模糊搜索姓名 / 邮箱 / 工号"
                  value={q}
                  onChange={(event) => {
                    setQ(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </div>

            <div ref={tableRef} className="ow-scroll min-h-0 flex-1 overflow-auto">
              {peopleQuery.isLoading ? (
                <LoadingBlock />
              ) : !peopleQuery.data?.items.length ? (
                <div className="flex h-full min-h-52 flex-col items-center justify-center gap-2 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                    <Users className="h-5 w-5" />
                  </div>
                  <p className="text-sm text-slate-500">{q ? "没有匹配的人员" : "该部门下没有人员"}</p>
                </div>
              ) : (
                <Table className="min-w-[820px] table-fixed [&_td]:py-2.5">
                  <colgroup>
                    <col className="w-[30%]" />
                    <col className="w-[34%]" />
                    <col className="w-[22%]" />
                    <col className="w-[14%]" />
                  </colgroup>
                  <TableHeader className="sticky top-0 z-10 bg-white">
                    <TableRow className="bg-slate-50 hover:bg-slate-50">
                      <TableHead>成员</TableHead>
                      <TableHead>邮箱</TableHead>
                      <TableHead>职位</TableHead>
                      <TableHead className="w-20">状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {page === 1
                      ? selectedLeaders
                          .filter((leader) => !leader.isMember)
                          .map((leader) => (
                            <TableRow key={`leader-${leader.openId}`} className="bg-amber-50/30 hover:bg-amber-50/50">
                              <TableCell>
                                <div className="flex items-center gap-2.5">
                                  <Avatar name={leader.name} src={leader.avatarUrl} size="sm" />
                                  <span className="font-medium text-slate-800">{leader.name}</span>
                                  <LeaderRoleBadge leader={leader} />
                                </div>
                              </TableCell>
                              <TableCell className="truncate text-slate-500" title={leader.email || "-"}>
                                {leader.email || "-"}
                              </TableCell>
                              <TableCell className="truncate text-slate-500" title={leader.jobTitle || "-"}>
                                {leader.jobTitle || "-"}
                              </TableCell>
                              <TableCell>
                                <Badge tone={leader.status === "active" ? "green" : "gray"} dot>
                                  {statusLabel(leader.status)}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))
                      : null}
                    {peopleQuery.data.items.map((person) => (
                      <TableRow
                        key={person.openId}
                        className="cursor-pointer"
                        onClick={() => setSelectedPerson(person)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={person.name} src={person.avatarUrl} size="sm" />
                            <span className="font-medium text-slate-800">{person.name}</span>
                            {selectedLeaderById.get(person.openId) ? (
                              <LeaderRoleBadge leader={selectedLeaderById.get(person.openId)!} />
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="truncate text-slate-500" title={displayEmail(person)}>
                          {displayEmail(person)}
                        </TableCell>
                        <TableCell className="truncate text-slate-500" title={person.jobTitle || "-"}>
                          {person.jobTitle || "-"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            tone={person.status === "active" ? "green" : person.status === "frozen" ? "orange" : "red"}
                            dot
                          >
                            {statusLabel(person.status)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <Pagination
              page={page}
              pageSize={pageSize}
              total={peopleQuery.data?.total ?? 0}
              onChange={setPage}
              pageSizeControl={
                <label className="hidden items-center gap-1.5 sm:flex">
                  每页
                  <Select
                    className="h-8 w-24 text-xs"
                    value={String(pageSizeMode)}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPageSizeMode(value === "auto" ? "auto" : Number(value));
                      setPage(1);
                    }}
                  >
                    <option value="auto">自适应</option>
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option} 条
                      </option>
                    ))}
                  </Select>
                  {pageSizeMode === "auto" ? (
                    <span className="text-[11px] text-slate-400">当前 {autoPageSize} 条</span>
                  ) : null}
                </label>
              }
            />
          </Card>
        </div>
      )}

      <Modal
        open={Boolean(selectedPerson)}
        onOpenChange={(open) => !open && setSelectedPerson(null)}
        title={detailQuery.data?.person.name ?? selectedPerson?.name ?? "人员详情"}
        description={
          detailQuery.data?.person
            ? `${displayEmail(detailQuery.data.person)} · ${detailQuery.data.person.jobTitle || "未填写职位"}`
            : undefined
        }
        width="max-w-2xl"
      >
        {detailQuery.isLoading ? (
          <LoadingBlock />
        ) : detailQuery.data ? (
          <div className="space-y-5">
            <div className="flex items-center gap-3 rounded-md bg-transparent p-4 ring-1 ring-inset ring-slate-100">
              <Avatar name={detailQuery.data.person.name} src={detailQuery.data.person.avatarUrl} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-slate-900">{detailQuery.data.person.name}</p>
                <p className="text-xs text-slate-500">{displayEmail(detailQuery.data.person)}</p>
              </div>
              <Badge tone={detailQuery.data.person.status === "active" ? "green" : "red"} dot>
                {statusLabel(detailQuery.data.person.status)}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
              <Badge tone="gray">工号 {detailQuery.data.person.employeeNo || "-"}</Badge>
              <Badge tone="gray">open_id {detailQuery.data.person.openId}</Badge>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-slate-500">所属部门</p>
              <div className="flex flex-wrap gap-1.5">
                {detailQuery.data.departments.length ? (
                  detailQuery.data.departments.map((department) => (
                    <Badge key={department.id} tone="blue">
                      {department.path}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-slate-500">未分配部门</span>
                )}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-slate-500">相关变更</p>
              {detailQuery.data.history.length ? (
                <ol className="relative space-y-3 border-l border-slate-200 pl-4">
                  {detailQuery.data.history.map((change) => (
                    <li key={change.id} className="relative">
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-slate-300 ring-4 ring-white" />
                      <p className="text-xs font-medium text-slate-700">{changeLabel(change.changeKind)}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {change.departmentPathAfter ?? change.departmentPathBefore ?? "-"} ·{" "}
                        {formatDateTime(change.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-slate-500">暂无相关差异记录</p>
              )}
            </div>

            <div className="flex justify-end border-t border-slate-100 pt-4">
              <Button variant="outline" size="sm" onClick={() => setSelectedPerson(null)}>
                关闭
              </Button>
            </div>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-rose-600">加载失败，请稍后重试</p>
        )}
      </Modal>
    </div>
  );
}

function DepartmentRow({
  department,
  subtitle,
  hasChildren,
  active,
  onClick,
}: {
  department: Department;
  subtitle: string;
  hasChildren: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors ${
        active ? "bg-primary-50 text-primary-800" : "text-slate-700 hover:bg-slate-50"
      }`}
      title={department.path}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
          active ? "bg-white text-primary-700 ring-1 ring-primary-100" : "bg-slate-100 text-slate-500"
        }`}
      >
        <Building2 className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{department.name}</span>
        <span className="mt-0.5 block truncate text-[11px] text-slate-400">{subtitle}</span>
      </span>
      <span
        className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
          active ? "bg-white/80 text-primary-700" : "bg-slate-100 text-slate-400"
        }`}
      >
        {department.memberCount}
      </span>
      {hasChildren ? (
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 ${
            active ? "text-primary-400" : "text-slate-300 group-hover:text-slate-500"
          }`}
        />
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
    </button>
  );
}

function LeaderRoleBadge({ leader }: { leader: { isPrimary: boolean } }) {
  return (
    <Badge tone={leader.isPrimary ? "yellow" : "blue"}>
      <Crown className="h-3 w-3" />
      {leader.isPrimary ? "主负责人" : "负责人"}
    </Badge>
  );
}

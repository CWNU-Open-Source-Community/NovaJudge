"use client";

import { AdminPageHeader, AdminTable } from "@/components/admin/AdminPage";
import { useAdminLocale } from "@/components/admin/useAdminLocale";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  FolderIcon,
  DocumentIcon,
  PencilIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

interface TrainingNode {
  id: string;
  name: string;
  slug: string | null;
  type: "FOLDER" | "CONTEST";
  parentId: string | null;
  contestId: number | null;
  rank: number;
  contest?: {
    id: number;
    title: string;
  };
}

interface Contest {
  id: number;
  title: string;
}

export default function TrainingAdminPage() {
  const { t } = useAdminLocale();
  const [nodes, setNodes] = useState<TrainingNode[]>([]);
  const [contests, setContests] = useState<Contest[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentParentId, setCurrentParentId] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<TrainingNode | null>(null);
  const [newNodeType, setNewNodeType] = useState<"FOLDER" | "CONTEST">(
    "FOLDER",
  );
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    contestId: "",
  });

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [nodesRes] = await Promise.all([
        fetch("/api/admin/training").then((r) => r.json()),
      ]);
      setNodes(nodesRes);
      // 注意：这里假设有一个获取所有比赛的接口，如果没有需要补充
      // 暂时用 fetch("/api/contests/export") 可能不对，应该用 fetch("/api/admin/contests/list") 之类的
      // 为了简单，我们先假设 /api/admin/contests/list 存在，或者直接在前端 fetch 列表
    } catch (e) {
      console.log(e);
      toast.error(t("Failed to load", "加载失败"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // 临时补一个 fetchContests
  const fetchContests = async () => {
    // 这里需要一个获取所有比赛的接口，简单起见我们假设有一个
    // 如果没有，可能需要新写一个 API
    try {
      const res = await fetch("/api/admin/contests/all-simple");
      if (res.ok) {
        const data = await res.json();
        setContests(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchData();
    fetchContests();
  }, [fetchData]);

  // Filter nodes by current parent
  const currentNodes = nodes.filter((n) => n.parentId === currentParentId);

  // Path navigation
  const getPath = (parentId: string | null): { id: string; name: string }[] => {
    if (!parentId) return [];
    const parent = nodes.find((n) => n.id === parentId);
    if (!parent) return [];
    return [...getPath(parent.parentId), { id: parent.id, name: parent.name }];
  };
  const breadcrumbs = getPath(currentParentId);

  // CRUD Operations
  const handleSave = async () => {
    try {
      const url = "/api/admin/training";
      const method = editingNode ? "PUT" : "POST";
      const body = {
        id: editingNode?.id,
        name: formData.name,
        slug: formData.slug,
        type: editingNode ? editingNode.type : newNodeType,
        parentId: currentParentId,
        contestId: formData.contestId,
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error("Failed");
      toast.success(t("Saved successfully", "保存成功"));
      setIsModalOpen(false);
      fetchData();
    } catch (e) {
      console.log(e);
      toast.error(t("Save failed", "保存失败"));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("Delete this item? Deleting a folder also removes its contents.", "确定删除吗？如果是文件夹，里面的内容也会被删除！"))) return;
    try {
      await fetch(`/api/admin/training?id=${id}`, { method: "DELETE" });
      toast.success(t("Deleted successfully", "删除成功"));
      fetchData();
    } catch (e) {
      console.log(e);
      toast.error(t("Delete failed", "删除失败"));
    }
  };

  const openCreateModal = (type: "FOLDER" | "CONTEST") => {
    setEditingNode(null);
    setNewNodeType(type);
    setFormData({ name: "", slug: "", contestId: "" });
    setIsModalOpen(true);
  };

  const openEditModal = (node: TrainingNode) => {
    setEditingNode(node);
    setFormData({
      name: node.name,
      slug: node.slug || "",
      contestId: node.contestId?.toString() || "",
    });
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t("Training catalog", "训练中心")} description={t("Organize training contests in folders.", "按目录组织训练比赛。")}>
        <button type="button" onClick={() => openCreateModal("FOLDER")} className="admin-button"><FolderIcon className="size-4" aria-hidden="true" />{t("New folder", "新建文件夹")}</button>
        <button type="button" onClick={() => openCreateModal("CONTEST")} className="admin-button admin-button-primary"><DocumentIcon className="size-4" aria-hidden="true" />{t("Add contest", "添加比赛")}</button>
      </AdminPageHeader>

      {/* Breadcrumbs */}
      <div className="admin-card flex flex-wrap items-center gap-2 px-4 py-3 text-sm text-gray-600">
        <button
          onClick={() => setCurrentParentId(null)}
          className="hover:text-blue-600 font-bold"
        >
          {t("Root", "根目录")}
        </button>
        {breadcrumbs.map((crumb) => (
          <div key={crumb.id} className="flex items-center gap-2">
            <span>/</span>
            <button
              onClick={() => setCurrentParentId(crumb.id)}
              className="hover:text-blue-600"
            >
              {crumb.name}
            </button>
          </div>
        ))}
      </div>

      {/* List */}
      <div className="admin-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">{t("Loading…", "加载中...")}</div>
        ) : currentNodes.length === 0 ? (
          <div className="p-8 text-center text-gray-500">{t("This folder is empty", "空文件夹")}</div>
        ) : (
          <AdminTable label={t("Training items", "训练目录")} className="min-w-[27rem]">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 font-medium">{t("Name", "名称")}</th>
                <th className="px-4 py-3 font-medium">{t("Type", "类型")}</th>
                <th className="px-4 py-3 font-medium">{t("Contest ID", "关联比赛ID")}</th>
                <th className="px-4 py-3 font-medium text-right">{t("Actions", "操作")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {currentNodes.map((node) => (
                <tr key={node.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {node.type === "FOLDER" ? (
                        <FolderIcon className="w-5 h-5 text-yellow-400" />
                      ) : (
                        <DocumentIcon className="w-5 h-5 text-blue-400" />
                      )}
                      {node.type === "FOLDER" ? (
                        <button
                          onClick={() => setCurrentParentId(node.id)}
                          className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                        >
                          {node.name}
                        </button>
                      ) : (
                        <span className="text-gray-900">{node.name}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {node.type === "FOLDER" ? t("Folder", "文件夹") : t("Contest link", "比赛链接")}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {node.contestId || "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEditModal(node)}
                        className="text-blue-600 hover:text-blue-800"
                        title={t("Edit", "编辑")}
                      >
                        <PencilIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(node.id)}
                        className="text-red-600 hover:text-red-800"
                        title={t("Delete", "删除")}
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-4">
          <div className="admin-card w-full max-w-md p-4 sm:p-6">
            <h2 className="text-xl font-bold mb-4">
              {editingNode ? t("Edit item", "编辑节点") : t("New item", "新建节点")}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("Name", "名称")}
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="w-full border rounded px-3 py-2"
                  placeholder={t("Enter a name", "请输入名称")}
                />
              </div>

              {(editingNode?.type === "FOLDER" ||
                (!editingNode && newNodeType === "FOLDER")) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("URL slug (optional)", "URL 别名 (Slug) - 可选")}
                  </label>
                  <input
                    type="text"
                    value={formData.slug}
                    onChange={(e) =>
                      setFormData({ ...formData, slug: e.target.value })
                    }
                    className="w-full border rounded px-3 py-2"
                    placeholder={t("e.g. 2023, acm-icpc", "例如: 2023, acm-icpc")}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {t("The URL uses /train/slug when set, or /train/ID otherwise.", "设置后 URL 将显示为 /train/别名，否则显示 /train/ID")}
                  </p>
                </div>
              )}

              {(editingNode?.type === "CONTEST" ||
                (!editingNode && newNodeType === "CONTEST")) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("Choose a contest", "选择比赛")}
                  </label>
                  <select
                    value={formData.contestId}
                    onChange={(e) => {
                      const cid = e.target.value;
                      const contest = contests.find(
                        (c) => c.id.toString() === cid,
                      );
                      setFormData({
                        ...formData,
                        contestId: cid,
                        name: contest ? contest.title : formData.name, // 自动填充比赛名称
                      });
                    }}
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="">{t("Select a contest…", "请选择比赛...")}</option>
                    {contests.map((c) => (
                      <option key={c.id} value={c.id}>
                        [{c.id}] {c.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
              >
                {t("Cancel", "取消")}
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                {t("Save", "保存")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

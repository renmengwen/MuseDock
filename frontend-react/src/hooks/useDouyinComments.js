import { useState } from 'react';
import { api } from '../api/client.js';

export function useDouyinComments() {
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentsState, setCommentsState] = useState({
    hint: '',
    data: [],
    awemeId: '',
    loading: false,
    loadingText: '',
  });

  async function loadComments(awemeId) {
    if (!awemeId) return;
    setCommentOpen(true);
    setCommentsState({
      hint: '正在读取本地评论缓存...',
      data: [],
      awemeId,
      loading: true,
      loadingText: '正在读取本地评论缓存...',
    });
    try {
      const json = await api.getLocalDouyinComments(awemeId);
      setCommentsState({
        hint: json.count
          ? `已加载本地缓存评论 ${json.count} 条`
          : '暂无本地评论缓存，可点击“获取最新评论”从抖音拉取',
        data: json.data || [],
        awemeId,
        loading: false,
        loadingText: '',
      });
    } catch (error) {
      setCommentsState({ hint: error.message, data: [], awemeId, loading: false, loadingText: '' });
    }
  }

  async function refreshLatestComments() {
    const awemeId = commentsState.awemeId;
    if (!awemeId) return;
    setCommentsState(prev => ({
      ...prev,
      hint: '正在从抖音获取最新评论和二级评论...',
      loading: true,
      loadingText: '正在获取最新评论和二级评论...',
    }));
    try {
      const json = await api.getDouyinComments(awemeId);
      setCommentsState({
        hint: `已获取最新评论 ${json.count || 0} 条（耗时 ${json.elapsed || '?'}）`,
        data: json.data || [],
        awemeId,
        loading: false,
        loadingText: '',
      });
    } catch (error) {
      setCommentsState(prev => ({ ...prev, hint: error.message, loading: false, loadingText: '' }));
    }
  }

  return {
    commentOpen,
    commentsState,
    setCommentOpen,
    loadComments,
    refreshLatestComments,
  };
}

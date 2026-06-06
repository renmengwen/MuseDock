const assert = require('assert');
const {
  buildDouyinSearchParams,
  canUseDouyinLoginStatus,
  getDouyinABogusFromJs,
  shouldSignDouyinApi,
  isDouyinCaptchaTitle,
  parseDouyinComment,
  enrichDouyinItemsWithDetails,
  parseDouyinSearchResponse,
} = require('./server/scraper/douyin');

function testBuildsSearchParams() {
  const params = buildDouyinSearchParams('codex', 15, '');
  assert.equal(params.keyword, 'codex');
  assert.equal(params.count, '15');
  assert.equal(params.offset, 0);
  assert.equal(params.search_channel, 'aweme_general');
  assert.equal(params.search_source, 'tab_search');
}

function testDetectsCaptchaTitle() {
  assert.equal(isDouyinCaptchaTitle('验证码中间页'), true);
  assert.equal(isDouyinCaptchaTitle('抖音-记录美好生活'), false);
}

function testRejectsCaptchaPageAsUsableLogin() {
  assert.equal(canUseDouyinLoginStatus({ loggedIn: true, title: '验证码中间页' }), false);
  assert.equal(canUseDouyinLoginStatus({ loggedIn: true, title: '抖音-记录美好生活' }), true);
  assert.equal(canUseDouyinLoginStatus({ loggedIn: false, title: '抖音-记录美好生活' }), false);
}

function testSignsCommentApisButNotSearch() {
  assert.equal(shouldSignDouyinApi('/aweme/v1/web/comment/list/'), true);
  assert.equal(shouldSignDouyinApi('/aweme/v1/web/comment/list/reply/'), true);
  assert.equal(shouldSignDouyinApi('/aweme/v1/web/general/search/single/'), false);
}

function testGeneratesABogusForComments() {
  const params = 'device_platform=webapp&aid=6383&aweme_id=7640385127511641382&cursor=0&count=3';
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
  const value = getDouyinABogusFromJs('/aweme/v1/web/comment/list/', params, ua);
  assert.equal(typeof value, 'string');
  assert.ok(value.length > 20);
}

function testParsesAwemeSearchData() {
  const response = {
    data: [
      {
        aweme_info: {
          aweme_id: '7420001',
          desc: 'Codex demo',
          create_time: 1780000100,
          author: { nickname: 'Alice' },
          statistics: { digg_count: 123, comment_count: 45 },
          aweme_type: 0,
          video: { duration: 61000, cover: { url_list: ['https://example.test/cover.jpg'] } },
        },
      },
      {
        aweme_mix_info: {
          mix_items: [
            {
              aweme_id: '7420002',
              desc: 'Mixed post',
              create_time: 1780000200,
              author: { nickname: 'Bob' },
              statistics: { digg_count: 9 },
            },
          ],
        },
      },
      {},
    ],
  };

  const parsed = parseDouyinSearchResponse(response, 'codex', 20);
  assert.deepEqual(parsed, [
    {
      aweme_id: '7420001',
      title: 'Codex demo',
      create_time: 1780000100,
      author: 'Alice',
      likes: 123,
      comment_count: 45,
      url: 'https://www.douyin.com/video/7420001',
      cover_url: 'https://example.test/cover.jpg',
      aweme_type: 0,
      duration_ms: 61000,
      keyword: 'codex',
    },
    {
      aweme_id: '7420002',
      title: 'Mixed post',
      create_time: 1780000200,
      author: 'Bob',
      likes: 9,
      comment_count: 0,
      url: 'https://www.douyin.com/video/7420002',
      cover_url: '',
      aweme_type: '',
      duration_ms: 0,
      keyword: 'codex',
    },
  ]);
}

async function testEnrichesSearchDataWithDetailsAndCrawlTime() {
  const now = 1780734200;
  const items = [
    {
      aweme_id: '7420001',
      title: 'missing metadata',
      url: 'https://www.douyin.com/video/7420001',
    },
  ];

  const enriched = await enrichDouyinItemsWithDetails(items, {
    nowSeconds: now,
    getDetail: async (awemeId) => ({
      success: true,
      data: {
        aweme_id: awemeId,
        aweme_type: 0,
        duration_ms: 125000,
        video_download_url: 'https://cdn.test/video.mp4',
      },
    }),
  });

  assert.equal(enriched[0].aweme_type, 0);
  assert.equal(enriched[0].duration_ms, 125000);
  assert.equal(enriched[0].video_download_url, 'https://cdn.test/video.mp4');
  assert.equal(enriched[0].crawled_at, now);
}

async function testKeepsSearchDataWhenDetailFails() {
  const items = [{ aweme_id: '7420002', title: 'fallback' }];
  const enriched = await enrichDouyinItemsWithDetails(items, {
    nowSeconds: 1780734300,
    getDetail: async () => ({ success: false, error: 'detail failed' }),
  });

  assert.equal(enriched[0].title, 'fallback');
  assert.equal(enriched[0].crawled_at, 1780734300);
}

function testParsesCommentWithReplies() {
  const parsed = parseDouyinComment({
    cid: 'c1',
    text: 'first',
    create_time: 1780000000,
    digg_count: 8,
    ip_label: '上海',
    reply_comment_total: 2,
    user: { uid: 'u1', nickname: 'Alice', avatar_thumb: { url_list: ['avatar'] } },
  }, [
    {
      cid: 'r1',
      text: 'reply',
      create_time: 1780000001,
      digg_count: 3,
      user: { uid: 'u2', nickname: 'Bob' },
    },
  ]);

  assert.deepEqual(parsed, {
    comment_id: 'c1',
    content: 'first',
    create_time: 1780000000,
    user_id: 'u1',
    nickname: 'Alice',
    avatar: 'avatar',
    like_count: 8,
    ip_location: '上海',
    sub_comment_count: 2,
    replies: [
      {
        comment_id: 'r1',
        content: 'reply',
        create_time: 1780000001,
        user_id: 'u2',
        nickname: 'Bob',
        avatar: '',
        like_count: 3,
        ip_location: '',
        sub_comment_count: 0,
        replies: [],
      },
    ],
  });
}

async function run() {
  testBuildsSearchParams();
  testDetectsCaptchaTitle();
  testRejectsCaptchaPageAsUsableLogin();
  testSignsCommentApisButNotSearch();
  testGeneratesABogusForComments();
  testParsesAwemeSearchData();
  await testEnrichesSearchDataWithDetailsAndCrawlTime();
  await testKeepsSearchDataWhenDetailFails();
  testParsesCommentWithReplies();
  console.log('douyin api parser tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

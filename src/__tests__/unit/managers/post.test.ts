import type { Post, PostCreateData, PostUpdateData, PaginationOptions } from '../../../types/post';
import type { DatabaseConnection } from '../../../database/types';
import type { Logger } from '../../../utils/logger';
import { PostManager } from '../../../managers/post';
import { jest } from '@jest/globals';

// Mock external dependencies
jest.mock('../../../database/connection');
jest.mock('../../../utils/logger');

// Extend Jest matchers for better assertions
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidPost(): R;
      toHaveValidTimestamps(): R;
    }
  }
}

expect.extend({
  toBeValidPost(received: any) {
    const pass =
      received &&
      typeof received.id === 'string' &&
      typeof received.title === 'string' &&
      typeof received.content === 'string' &&
      typeof received.authorId === 'string';
    return {
      message: () => `expected ${this.utils.printReceived(received)} to be a valid post object`,
      pass,
    };
  },
  toHaveValidTimestamps(received: any) {
    const pass =
      received &&
      received.createdAt instanceof Date &&
      (received.updatedAt === undefined || received.updatedAt instanceof Date);
    return {
      message: () => `expected ${this.utils.printReceived(received)} to have valid timestamps`,
      pass,
    };
  },
});

describe('PostManager', () => {
  let postManager: PostManager;
  let mockDb: jest.Mocked<DatabaseConnection>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = {
      query: jest.fn(),
      transaction: jest.fn(),
    } as any;
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as any;
    postManager = new PostManager(mockDb, mockLogger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createPost', () => {
    const validPostData: PostCreateData = {
      title: 'Test Post',
      content: 'This is test content',
      authorId: 'user123',
      tags: ['tech', 'javascript'],
    };

    it('should create a post successfully with valid data', async () => {
      const expectedPost: Post = { id: 'post123', ...validPostData, createdAt: new Date() };
      mockDb.query.mockResolvedValueOnce({ rows: [expectedPost] } as any);

      const result = await postManager.createPost(validPostData);

      expect(result).toEqual(expectedPost);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO posts'),
        expect.arrayContaining([validPostData.title, validPostData.content, validPostData.authorId])
      );
      expect(mockLogger.info).toHaveBeenCalledWith('Post created successfully', { postId: expectedPost.id });
    });

    it('should throw error when title is missing', async () => {
      await expect(postManager.createPost({ ...validPostData, title: '' })).rejects.toThrow('Title is required');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should throw error when content is missing', async () => {
      await expect(postManager.createPost({ ...validPostData, content: '' })).rejects.toThrow('Content is required');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should throw error when authorId is missing', async () => {
      await expect(postManager.createPost({ ...validPostData, authorId: '' })).rejects.toThrow('Author ID is required');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      const dbError = new Error('Database connection failed');
      mockDb.query.mockRejectedValueOnce(dbError);

      await expect(postManager.createPost(validPostData)).rejects.toThrow('Failed to create post');
      expect(mockLogger.error).toHaveBeenCalledWith('Error creating post', { error: dbError });
    });

    it('should handle extremely long titles', async () => {
      const longTitle = 'a'.repeat(1000);
      await expect(postManager.createPost({ ...validPostData, title: longTitle })).rejects.toThrow('Title too long');
    });

    it('should sanitize HTML content', async () => {
      const dataWithHtml = { ...validPostData, content: '<script>alert("xss")</script>Valid content' };
      const sanitizedPost = { id: 'post123', ...dataWithHtml, content: 'Valid content', createdAt: new Date() };
      mockDb.query.mockResolvedValueOnce({ rows: [sanitizedPost] } as any);

      const result = await postManager.createPost(dataWithHtml);

      expect(result.content).not.toContain('<script>');
      expect(result.content).toContain('Valid content');
    });
  });

  describe('getPostById', () => {
    it('should return post when found', async () => {
      const expectedPost: Post = {
        id: 'post123',
        title: 'Test Post',
        content: 'Content',
        authorId: 'user123',
        createdAt: new Date(),
      };
      mockDb.query.mockResolvedValueOnce({ rows: [expectedPost] } as any);

      const result = await postManager.getPostById('post123');

      expect(result).toEqual(expectedPost);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM posts WHERE id = $1'),
        ['post123']
      );
    });

    it('should return null when post not found', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] } as any);
      const result = await postManager.getPostById('nonexistent');
      expect(result).toBeNull();
    });

    it('should throw error for invalid ID format', async () => {
      await expect(postManager.getPostById('')).rejects.toThrow('Invalid post ID');
      await expect(postManager.getPostById(null as any)).rejects.toThrow('Invalid post ID');
      await expect(postManager.getPostById(undefined as any)).rejects.toThrow('Invalid post ID');
    });

    it('should handle database errors', async () => {
      const dbError = new Error('Database error');
      mockDb.query.mockRejectedValueOnce(dbError);

      await expect(postManager.getPostById('post123')).rejects.toThrow('Failed to retrieve post');
      expect(mockLogger.error).toHaveBeenCalledWith('Error retrieving post', { postId: 'post123', error: dbError });
    });
  });

  describe('updatePost', () => {
    const updateData: PostUpdateData = { title: 'Updated Title', content: 'Updated content' };

    it('should update post successfully', async () => {
      const updatedPost: Post = {
        id: 'post123',
        ...updateData,
        authorId: 'user123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockDb.query.mockResolvedValueOnce({ rows: [updatedPost] } as any);

      const result = await postManager.updatePost('post123', updateData);

      expect(result).toEqual(updatedPost);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE posts SET'),
        expect.arrayContaining(['post123'])
      );
    });

    it('should return null when updating non-existent post', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] } as any);
      const result = await postManager.updatePost('nonexistent', updateData);
      expect(result).toBeNull();
    });

    it('should validate update data', async () => {
      await expect(postManager.updatePost('post123', { title: '' })).rejects.toThrow('Title cannot be empty');
      await expect(postManager.updatePost('post123', { content: '' })).rejects.toThrow('Content cannot be empty');
    });

    it('should handle partial updates', async () => {
      const partialUpdate = { title: 'New Title Only' };
      const updatedPost: Post = {
        id: 'post123',
        ...partialUpdate,
        content: 'Original content',
        authorId: 'user123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockDb.query.mockResolvedValueOnce({ rows: [updatedPost] } as any);

      const result = await postManager.updatePost('post123', partialUpdate);
      expect(result!.title).toBe('New Title Only');
      expect(result!.content).toBe('Original content');
    });
  });

  describe('deletePost', () => {
    it('should delete post successfully', async () => {
      mockDb.query.mockResolvedValueOnce({ rowCount: 1 } as any);
      const result = await postManager.deletePost('post123');
      expect(result).toBe(true);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM posts WHERE id = $1'),
        ['post123']
      );
      expect(mockLogger.info).toHaveBeenCalledWith('Post deleted', { postId: 'post123' });
    });

    it('should return false when post does not exist', async () => {
      mockDb.query.mockResolvedValueOnce({ rowCount: 0 } as any);
      const result = await postManager.deletePost('nonexistent');
      expect(result).toBe(false);
    });

    it('should throw error for invalid ID', async () => {
      await expect(postManager.deletePost('')).rejects.toThrow('Invalid post ID');
    });

    it('should handle database errors', async () => {
      const dbError = new Error('Database error');
      mockDb.query.mockRejectedValueOnce(dbError);
      await expect(postManager.deletePost('post123')).rejects.toThrow('Failed to delete post');
    });
  });

  describe('getAllPosts', () => {
    it('should return all posts with default pagination', async () => {
      const mockPosts: Post[] = [
        { id: 'post1', title: 'Post 1', content: '...', authorId: 'user1', createdAt: new Date() },
        { id: 'post2', title: 'Post 2', content: '...', authorId: 'user2', createdAt: new Date() },
      ];
      mockDb.query.mockResolvedValueOnce({ rows: mockPosts } as any);
      const result = await postManager.getAllPosts();
      expect(result).toEqual(mockPosts);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM posts'),
        expect.arrayContaining([50, 0])
      );
    });

    it('should handle custom pagination', async () => {
      const mockPosts: Post[] = [{ id: 'post1', title: 'Post 1', content: '...', authorId: 'user1', createdAt: new Date() }];
      mockDb.query.mockResolvedValueOnce({ rows: mockPosts } as any);
      const result = await postManager.getAllPosts({ limit: 10, offset: 20 });
      expect(result).toEqual(mockPosts);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $1 OFFSET $2'),
        expect.arrayContaining([10, 20])
      );
    });

    it('should return empty array when no posts exist', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] } as any);
      const result = await postManager.getAllPosts();
      expect(result).toEqual([]);
    });

    it('should validate pagination parameters', async () => {
      await expect(postManager.getAllPosts({ limit: -1 })).rejects.toThrow('Invalid limit');
      await expect(postManager.getAllPosts({ offset: -1 })).rejects.toThrow('Invalid offset');
      await expect(postManager.getAllPosts({ limit: 1001 })).rejects.toThrow('Limit too large');
    });
  });

  describe('searchPosts', () => {
    it('should search posts by title', async () => {
      const mockPosts: Post[] = [
        { id: 'post1', title: 'JavaScript Guide', content: 'Content', authorId: 'user1', createdAt: new Date() },
      ];
      mockDb.query.mockResolvedValueOnce({ rows: mockPosts } as any);
      const result = await postManager.searchPosts('JavaScript');
      expect(result).toEqual(mockPosts);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE title ILIKE $1 OR content ILIKE $1'),
        ['%JavaScript%']
      );
    });

    it('should return empty array for no matches', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] } as any);
      const result = await postManager.searchPosts('nonexistent');
      expect(result).toEqual([]);
    });

    it('should handle empty search term', async () => {
      await expect(postManager.searchPosts('')).rejects.toThrow('Search term is required');
      await expect(postManager.searchPosts('  ')).rejects.toThrow('Search term is required');
    });

    it('should handle very long search terms', async () => {
      const longTerm = 'a'.repeat(1000);
      await expect(postManager.searchPosts(longTerm)).rejects.toThrow('Search term too long');
    });
  });

  describe('getPostsByAuthor', () => {
    it('should return posts by specific author', async () => {
      const authorPosts: Post[] = [
        { id: 'post1', title: 'Post 1', content: '...', authorId: 'user123', createdAt: new Date() },
        { id: 'post2', title: 'Post 2', content: '...', authorId: 'user123', createdAt: new Date() },
      ];
      mockDb.query.mockResolvedValueOnce({ rows: authorPosts } as any);
      const result = await postManager.getPostsByAuthor('user123');
      expect(result).toEqual(authorPosts);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE authorId = $1'),
        ['user123']
      );
    });

    it('should return empty array when author has no posts', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] } as any);
      const result = await postManager.getPostsByAuthor('user456');
      expect(result).toEqual([]);
    });

    it('should validate author ID', async () => {
      await expect(postManager.getPostsByAuthor('')).rejects.toThrow('Author ID is required');
      await expect(postManager.getPostsByAuthor(null as any)).rejects.toThrow('Author ID is required');
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle concurrent operations gracefully', async () => {
      const promises = [
        postManager.createPost({ title: 'Post 1', content: 'Content 1', authorId: 'user1', tags: [] }),
        postManager.createPost({ title: 'Post 2', content: 'Content 2', authorId: 'user2', tags: [] }),
        postManager.createPost({ title: 'Post 3', content: 'Content 3', authorId: 'user3', tags: [] }),
      ];
      mockDb.query.mockResolvedValue({ rows: [{ id: 'post123', createdAt: new Date() }] } as any);
      const results = await Promise.all(promises);
      expect(results).toHaveLength(3);
      expect(mockDb.query).toHaveBeenCalledTimes(3);
    });

    it('should handle database connection timeout', async () => {
      const timeoutError = new Error('Connection timeout');
      timeoutError.name = 'TimeoutError';
      mockDb.query.mockRejectedValueOnce(timeoutError);
      await expect(
        postManager.createPost({ title: 'Test', content: 'Test', authorId: 'user1', tags: [] })
      ).rejects.toThrow('Database timeout');
    });

    it('should handle memory pressure with large content', async () => {
      const largeContent = 'a'.repeat(10_000_000);
      await expect(
        postManager.createPost({ title: 'Large Post', content: largeContent, authorId: 'user1', tags: [] })
      ).rejects.toThrow('Content too large');
    });
  });

  describe('transaction handling', () => {
    it('should use transactions for complex operations', async () => {
      const mockTransaction = { query: jest.fn(), commit: jest.fn(), rollback: jest.fn() } as any;
      mockDb.transaction.mockReturnValueOnce(mockTransaction);
      mockTransaction.query.mockResolvedValueOnce({ rows: [{ id: 'post123' }] } as any);
      await postManager.createPostWithTags({
        title: 'Test',
        content: 'Test',
        authorId: 'user1',
        tags: ['tag1', 'tag2'],
      });
      expect(mockDb.transaction).toHaveBeenCalled();
      expect(mockTransaction.commit).toHaveBeenCalled();
    });

    it('should rollback transaction on error', async () => {
      const mockTransaction = { query: jest.fn(), commit: jest.fn(), rollback: jest.fn() } as any;
      mockDb.transaction.mockReturnValueOnce(mockTransaction);
      mockTransaction.query.mockRejectedValueOnce(new Error('Tag creation failed'));
      await expect(
        postManager.createPostWithTags({
          title: 'Test',
          content: 'Test',
          authorId: 'user1',
          tags: ['tag1'],
        })
      ).rejects.toThrow();
      expect(mockTransaction.rollback).toHaveBeenCalled();
      expect(mockTransaction.commit).not.toHaveBeenCalled();
    });
  });
});

describe('PostManager Performance Tests', () => {
  it('should handle bulk operations efficiently', async () => {
    const startTime = Date.now();
    const bulkData: PostCreateData[] = Array.from({ length: 100 }, (_, i) => ({
      title: `Post ${i}`,
      content: `Content ${i}`,
      authorId: `user${i}`,
      tags: [],
    }));
    mockDb.query.mockResolvedValue({ rows: [{ id: 'post123' }] } as any);

    await postManager.bulkCreatePosts(bulkData);

    const endTime = Date.now();
    expect(endTime - startTime).toBeLessThan(5000);
    expect(mockDb.query).toHaveBeenCalledTimes(1);
  });

  it('should handle rapid sequential requests without race conditions', async () => {
    let callCount = 0;
    mockDb.query.mockImplementation(() => {
      callCount++;
      return Promise.resolve({ rows: [{ id: `post${callCount}` }] } as any);
    });

    const promises = Array.from({ length: 10 }, (_, i) =>
      postManager.createPost({ title: `Post ${i}`, content: `Content ${i}`, authorId: 'user1', tags: [] })
    );

    const results = await Promise.all(promises);
    expect(results).toHaveLength(10);
    expect(new Set(results.map(r => r.id)).size).toBe(10);
  });
});

describe('PostManager Integration Scenarios', () => {
  it('should maintain data consistency during complex workflows', async () => {
    const postData: PostCreateData = {
      title: 'Integration Test',
      content: 'Test content',
      authorId: 'testuser',
      tags: [],
    };
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 'post123', ...postData }] } as any) // create
      .mockResolvedValueOnce({ rows: [{ id: 'post123', title: 'Updated', content: 'Test content' }] } as any) // update
      .mockResolvedValueOnce({ rows: [{ id: 'post123', title: 'Updated', content: 'Test content' }] } as any) // search
      .mockResolvedValueOnce({ rowCount: 1 } as any); // delete

    const created = await postManager.createPost(postData);
    const updated = await postManager.updatePost('post123', { title: 'Updated' });
    const found = await postManager.searchPosts('Updated');
    const deleted = await postManager.deletePost('post123');

    expect(created.id).toBe('post123');
    expect(updated!.title).toBe('Updated');
    expect(found).toHaveLength(1);
    expect(deleted).toBe(true);
  });
});

describe('PostManager External Dependencies', () => {
  it('should handle logger unavailability gracefully', async () => {
    const postManagerWithoutLogger = new PostManager(mockDb, null as any);
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 'post123', title: 'Test', content: 'Test', authorId: 'user1', createdAt: new Date() }],
    } as any);

    await expect(
      postManagerWithoutLogger.createPost({
        title: 'Test',
        content: 'Test content',
        authorId: 'user1',
        tags: [],
      })
    ).resolves.toBeDefined();
  });

  it('should validate against database schema constraints', async () => {
    const schemaError = new Error('duplicate key value violates unique constraint');
    schemaError.name = 'UniqueConstraintError';
    mockDb.query.mockRejectedValueOnce(schemaError);

    await expect(
      postManager.createPost({
        title: 'Duplicate Title',
        content: 'Content',
        authorId: 'user1',
        tags: [],
      })
    ).rejects.toThrow('Post with this title already exists');
  });

  it('should handle database migration scenarios', async () => {
    const migrationError = new Error('column "new_field" does not exist');
    mockDb.query.mockRejectedValueOnce(migrationError);
    const fallbackQuery = jest.fn().mockResolvedValueOnce({
      rows: [{ id: 'post123', title: 'Test', content: 'Content', authorId: 'user1', createdAt: new Date() }],
    } as any);
    mockDb.query.mockImplementationOnce(fallbackQuery);

    await expect(
      postManager.createPost({
        title: 'Test',
        content: 'Content',
        authorId: 'user1',
        tags: [],
      })
    ).resolves.toBeDefined();
  });
});
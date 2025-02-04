import { fatalError } from '../fatal-error'
import { INodeFilter } from './node-filter'
import * as FSE from 'fs-extra'
import uri2path from 'file-uri-to-path'

/**
 * The Emoji Markdown filter will take a text node and create multiple text and
 * image nodes by inserting emoji images using base64 data uri where emoji
 * references are in the text node.
 *
 * Example: A text node of "That is great! :+1: Good Job!"
 * Becomes three nodes: "That is great! ",<img src="data uri for :+1:>, " Good Job!"
 *
 * Notes: We are taking the emoji file paths and creating the base 64 data URI
 * because this is to be injected into a sandboxed markdown parser were we will
 * no longer have access to the local file paths.
 */
export class EmojiFilter implements INodeFilter {
  private readonly emojiFilePath: Map<string, string>
  private readonly emojiBase64URICache: Map<string, string> = new Map()

  /**
   * @param emoji Map from the emoji ref (e.g., :+1:) to the image's local path.
   */
  public constructor(emojiFilePath: Map<string, string>) {
    this.emojiFilePath = emojiFilePath
  }

  /**
   * Emoji filter iterates on all text nodes that are not inside a pre or code tag.
   */
  public createFilterTreeWalker(doc: Document): TreeWalker {
    return doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        return node.parentNode !== null &&
          ['CODE', 'PRE'].includes(node.parentNode.nodeName)
          ? NodeFilter.FILTER_SKIP
          : NodeFilter.FILTER_ACCEPT
      },
    })
  }

  /**
   * Takes a text node and creates multiple text and image nodes by inserting
   * emoji image nodes using base64 data uri where emoji references are.
   *
   * Example: A text node of "That is great! :+1: Good Job!" Becomes three
   * nodes: ["That is great! ",<img src="data uri for :+1:>, " Good Job!"]
   */
  public async filter(node: Node): Promise<ReadonlyArray<Node> | null> {
    if (!(node instanceof Text)) {
      fatalError(
        'Emoji filter requires text nodes; otherwise we may inadvertently replace non text elements.'
      )
    }

    if (node.textContent === null || !node.textContent.includes(':')) {
      return null
    }

    let text = node.textContent
    // Matches groups of one or more (+) non white space (\S) characters between two :'s
    // Lazy quantifier ? so :emoji:notemoji:emoji: is not one complete match, but :emoji: and :emoji: will be.
    const emojiRegex: RegExp = /(:\S+?:)/g
    const emojiMatches = text.match(emojiRegex)
    if (emojiMatches === null) {
      return null
    }

    const nodes: Array<Text | HTMLImageElement> = []
    for (let i = 0; i < emojiMatches.length; i++) {
      const emojiKey = emojiMatches[i]
      const emojiPath = this.emojiFilePath.get(emojiKey)
      if (emojiPath === undefined) {
        continue
      }

      const emojiPosition = text.indexOf(emojiMatches[0])
      const textBeforeEmoji = text.slice(0, emojiPosition)
      const textNodeBeforeEmoji = document.createTextNode(textBeforeEmoji)
      nodes.push(textNodeBeforeEmoji)

      const emojiImg = await this.createEmojiNode(emojiPath)
      nodes.push(emojiImg)

      text = text.slice(emojiPosition + emojiKey.length)
    }

    if (text !== '') {
      const trailingTextNode = document.createTextNode(text)
      nodes.push(trailingTextNode)
    }

    return nodes
  }

  /**
   * Method to build an emoji image node to insert in place of the emoji ref
   */
  private async createEmojiNode(emojiPath: string) {
    const dataURI = await this.getBase64FromImageUrl(emojiPath)
    const emojiImg = new Image()
    emojiImg.classList.add('emoji')
    emojiImg.src = dataURI
    return emojiImg
  }

  /**
   * Method to obtain an images base 64 data uri from it's file path.
   * - It checks cache, if not, reads from file, then stores in cache.
   */
  private async getBase64FromImageUrl(filePath: string): Promise<string> {
    const cached = this.emojiBase64URICache.get(filePath)
    if (cached !== undefined) {
      return cached
    }
    const imageBuffer = await FSE.readFile(uri2path(filePath))
    const b64src = imageBuffer.toString('base64')
    const uri = `data:image/png;base64,${b64src}`
    this.emojiBase64URICache.set(filePath, uri)

    return uri
  }
}

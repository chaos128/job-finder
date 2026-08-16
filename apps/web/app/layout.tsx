import { Poppins } from 'next/font/google'
import './globals.css'
import { TopBar } from './_components/top-bar'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
})

export const metadata = {
  title: 'Job Finder',
  description: 'Wanted 공고를 이력서와 대조 채점해 매일 다이제스트로 보내는 개인용 서비스',
  // 인증이 없는 공개 페이지다. 채점 근거에 경력 정보가 담기므로 색인만은 막는다.
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={poppins.variable}>
      <body className="bg-neutral-50 font-sans text-neutral-900 antialiased">
        <TopBar />
        {children}
      </body>
    </html>
  )
}
